/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { PassthroughBehavior, RestApi, StepFunctionsIntegration } from 'aws-cdk-lib/aws-apigateway'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb'
import { StringParameter } from 'aws-cdk-lib/aws-ssm'
import { Choice, Condition, CustomState, Fail, IChainable, IntegrationPattern, JsonPath, LogLevel, Pass, Result, StateMachine, StateMachineType, Succeed, TaskInput, Wait, WaitTime } from 'aws-cdk-lib/aws-stepfunctions'
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets'
import { DynamoAttributeValue, DynamoGetItem, LambdaInvoke, StepFunctionsStartExecution } from 'aws-cdk-lib/aws-stepfunctions-tasks'
import { EventBus, Rule } from 'aws-cdk-lib/aws-events'
import { LogGroup } from 'aws-cdk-lib/aws-logs'

export class AppStack extends Stack {
  private readonly channelIdParameter: StringParameter
  private readonly slackAuthFunction: NodejsFunction
  private readonly httpsClientFunction: NodejsFunction
  private readonly botUsersTable: Table
  private readonly commandEventBus: EventBus

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    // Secrets and Parameters
    const slackSecrets = new Secret(this, 'SlackSecrets', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          botToken: '<insert bot token here in AWS Console>',
          signingSecret: '<insert bot token here in AWS Console>'
        }),
        generateStringKey: 'signingSecret'
      },
    })

    this.channelIdParameter = new StringParameter(this, 'SlackChannelIdParameter', {
      parameterName: 'SlackChannelIdParameter',
      description: 'The permitted slack channel ID for Slack Bot requets',
      stringValue: '<insert channel ID here in AWS Console>'
    })

    // DB Tables
    this.botUsersTable = new Table(this, 'BotUsersTable', {
      billingMode: BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1,
      removalPolicy: RemovalPolicy.DESTROY,
      partitionKey: { name: 'slackUserName', type: AttributeType.STRING }
    })

    // Lambda Functions
    const bundlingConfig = {
      externalModules: [
        'aws-sdk'
      ]
    }
    this.slackAuthFunction = new NodejsFunction(this, 'slack-auth', {
      environment: {
        SLACK_SECRETS_NAME: slackSecrets.secretName
      },
      bundling: bundlingConfig
    })
    this.httpsClientFunction = new NodejsFunction(this, 'https-client', {
      environment: {
        SLACK_SECRETS_NAME: slackSecrets.secretName
      },
      bundling: bundlingConfig
    })
    const sampleLambdaFunction = new NodejsFunction(this, 'sample-lambda')

    // EventBridge
    this.commandEventBus = new EventBus(this, 'CommandEventBus', {
      eventBusName: 'command-event-bus'
    })

    // State Machines
    const sampleStateMachine = this.buildSampleStateMachine()
    const requestValidatorStateMachine = this.buildRequestValidatorStateMachine()
    this.buildWelcomeProcessor()
    this.buildFormProcessor('SampleLambdaProcessor', 'Sample Lambda', 'sample-lambda')
    this.buildLambdaFormSubmitProcessor('SampleLambdaSubmitProcessor', 'Sample Lambda', 'sample-lambda/submit', sampleLambdaFunction)
    this.buildFormProcessor('SampleStateMachineProcessor', 'Sample State Machine', 'sample-sm')
    this.buildStateMachineFormSubmitProcessor('SampleStateMachineSubmitProcessor', 'Sample State Machine', 'sample-sm/submit', sampleStateMachine)

    // Grant Permissions
    slackSecrets.grantRead(this.slackAuthFunction)
    this.channelIdParameter.grantRead(requestValidatorStateMachine)
    slackSecrets.grantRead(this.httpsClientFunction)
    this.commandEventBus.grantPutEventsTo(requestValidatorStateMachine)

    // API Gateway
    const boltApi = new RestApi(this, 'SlackAppApi', {
      restApiName: 'Interactive Slack App Starter Kit API',
      description: 'This is the API service for the Interactive Slack App Starter Kit.',
    })
    // POST /slack/events
    boltApi.root
      .addProxy({
        defaultIntegration: StepFunctionsIntegration.startExecution(requestValidatorStateMachine, {
          passthroughBehavior: PassthroughBehavior.NEVER,
          requestTemplates: {
            'application/x-www-form-urlencoded': `
              {
                  "stateMachineArn": "${requestValidatorStateMachine.stateMachineArn}",
                  "input": "{\\"body\\": \\"$input.path('$')\\", \\"headers\\": {\\"X-Slack-Signature\\": \\"$input.params().header.get('X-Slack-Signature')\\", \\"X-Slack-Request-Timestamp\\": \\"$input.params().header.get('X-Slack-Request-Timestamp')\\", \\"Content-Type\\": \\"application/x-www-form-urlencoded\\"}}"
              }
            `
          },
          integrationResponses: [{
            statusCode: '200',
            responseTemplates: {
              'application/json': `
                #set($context.responseOverride.status = 204)
                {}
              `
            }
          }]
        })
      })
  }

  private buildRequestValidatorStateMachine(): StateMachine {
    const logGroup = new LogGroup(this, 'RequestValidatorStateMachineLogGroup')

    // Validate Slack message
    const validateSlackMessage = new LambdaInvoke(this, 'Validate Slack Message', {
      lambdaFunction: this.slackAuthFunction,
      resultSelector: { 'request.$': '$.Payload' }
    })
      .addCatch(new Fail(this, 'Validate Slack Message Failure'), {
        errors: ['States.ALL']
      })

    // Get Channel ID value
    const getChannelId = new CustomState(this, 'Get Channel ID Value', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::aws-sdk:ssm:getParameter',
        Parameters: {
          Name: this.channelIdParameter.parameterName
        },
        ResultPath: '$.getParameterResult'
      }
    })

    // Get Slack User (executes after Validate Channel ID)
    const getSlackUser = new DynamoGetItem(this, 'Get Slack User', {
      key: { slackUserName: DynamoAttributeValue.fromString(JsonPath.stringAt('$.request.userName')) },
      table: this.botUsersTable,
      resultPath: '$.getUserResult'
    })

    const sendUnauthorizedUserMessage = this.sendEphemeralMessage('Unauthorized User Message', { text: 'You are not authorized to use this command here', response_type: 'ephemeral' })

    // Validate Channel ID
    const validateChannelId = new Choice(this, 'Validate Channel ID')
      .when(Condition.stringEqualsJsonPath('$.getParameterResult.Parameter.Value', '$.request.channelId'), getSlackUser)
      .otherwise(sendUnauthorizedUserMessage)

    // Send to Command EventBus
    const sendToCommandEventBus = new CustomState(this, 'Send to Command EventBus', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::events:putEvents',
        Parameters: {
          Entries: [
            {
              'Detail.$': '$.request',
              'DetailType.$': '$.request.action',
              EventBusName: this.commandEventBus.eventBusName,
              Source: 'slack-app'
            }
          ]
        }
      }
    })
    const mapPermittedActions = new Pass(this, 'Map User Actions', {
      inputPath: '$.getUserResult.Item.permittedActions.SS',
      resultPath: '$.request.permittedActions'
    })
      .next(sendToCommandEventBus)

    // Filter User Permitted Actions
    const filterPermittedActions = new Pass(this, 'Filter User Actions', {
      inputPath: '$.getUserResult.Item.permittedActions.SS[?(@ == $.request.actionBase)]',
      resultPath: '$.permittedActionsFilter'
    })
      .next(new Choice(this, 'Validate Permitted Actions')
        .when(Condition.isPresent('$.permittedActionsFilter[0]'), mapPermittedActions)
        .otherwise(sendUnauthorizedUserMessage)
      )

    // Validate Slack user
    const validateSlackUser = new Choice(this, 'Validate Slack User')
      // A user was found in the table AND the action is the welcome screen
      .when(Condition.and(Condition.isPresent('$.getUserResult.Item'), Condition.stringEquals('$.request.action', 'welcome')), mapPermittedActions)
      // A user was found in the table AND the action is not the welcome screen
      .when(Condition.and(Condition.isPresent('$.getUserResult.Item'), Condition.not(Condition.stringEquals('$.request.action', 'welcome'))), filterPermittedActions)
      .otherwise(sendUnauthorizedUserMessage)
    getSlackUser.next(validateSlackUser)

    // Coordinate states
    const definition = validateSlackMessage
      .next(getChannelId)
      .next(validateChannelId)

    return new StateMachine(this, 'RequestValidator', {
      definition,
      stateMachineType: StateMachineType.EXPRESS,
      logs: {
        destination: logGroup,
        level: LogLevel.ALL,
        includeExecutionData: true
      }
    })
  }

  private sendEphemeralMessage(id: string, body: any, responseUrlPath: string = 'request.responseUrl'): LambdaInvoke {
    return new LambdaInvoke(this, id, {
      lambdaFunction: this.httpsClientFunction,
      payload: TaskInput.fromObject({ 'url.$': `$.${responseUrlPath}`, body }),
      resultPath: JsonPath.DISCARD
    })
  }

  private postMessageInChannel(id: string, blocks: any[]): LambdaInvoke {
    return new LambdaInvoke(this, id, {
      lambdaFunction: this.httpsClientFunction,
      payload: TaskInput.fromObject({
        url: 'https://slack.com/api/chat.postMessage',
        body: {
          'channel.$': '$.detail.channelId',
          blocks
        }
      }),
      resultPath: '$.postMessageResult'
    })
  }

  private updatePostedMessage(id: string, blocks: any[]): LambdaInvoke {
    return new LambdaInvoke(this, id, {
      lambdaFunction: this.httpsClientFunction,
      payload: TaskInput.fromObject({
        url: 'https://slack.com/api/chat.update',
        body: {
          'channel.$': '$.detail.channelId',
          'ts.$': '$.postMessageResult.Payload.ts',
          blocks
        }
      }),
      resultPath: JsonPath.DISCARD
    })
  }

  private buildSampleStateMachine() {
    const waitX = new Wait(this, 'Wait X Seconds', {
      time: WaitTime.secondsPath('$.waitSeconds'),
    })
    const pass = new Pass(this, 'Add Result', {
      result: Result.fromString('some result'),
      resultPath: '$.result',
    })
    const jobSuccess = new Succeed(this, 'Job Succcess')
    const definition = waitX.next(pass).next(jobSuccess)

    const logGroup = new LogGroup(this, 'SampleStateMachineLogGroup')

    return new StateMachine(this, 'SampleStateMachine', {
      definition,
      stateMachineType: StateMachineType.EXPRESS,
      logs: {
        destination: logGroup,
        level: LogLevel.ALL,
        includeExecutionData: true
      }
    })
  }

  private buildWelcomeProcessor() {
    const sendWelcomeBlocks = this.sendEphemeralMessage('Send Welcome Blocks to Slack', {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Hello! I\'m a slack bot here to help you.\n\n *Please select an action:*'
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Sample Lambda',
                emoji: true
              },
              action_id: 'sample-lambda'
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Sample State Machine',
                emoji: true
              },
              action_id: 'sample-sm'
            }
          ]
        }
      ]
    }, 'detail.responseUrl')

    this.buildStateMachineProcessor('WelcomeStateMachineProcessor', sendWelcomeBlocks, 'welcome')
  }

  private buildFormProcessor(id: string, title: string, action: string) {
    const definition = new Pass(this, `${id} Build Form Blocks Request`, {
      result: Result.fromArray([
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: title,
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Here\'s a description about what kind of input this form expects.'
          }
        },
        {
          type: 'input',
          block_id: 'form_input',
          element: {
            type: 'plain_text_input',
            action_id: 'input_value'
          },
          label: {
            type: 'plain_text',
            text: 'Input Value',
            emoji: true
          },
        },
        {
          type: 'actions',
          elements: [
            {
              action_id: `${action}/submit`,
              type: 'button',
              style: 'primary',
              text: {
                type: 'plain_text',
                text: 'Submit',
                emoji: true
              },
              value: `${action}/submit`
            }
          ]
        }
      ]),
      resultPath: '$.blocks'
    })
      .next(this.sendEphemeralMessage(`${id} Send Form Blocks to Slack`, {
        blocks: JsonPath.listAt('$.blocks')
      }, 'detail.responseUrl'))

    this.buildStateMachineProcessor(id, definition, action)
  }

  private buildLambdaFormSubmitProcessor(id: string, title: string, action: string, lambdaFunction: NodejsFunction) {
    const deleteFormMessage = this.sendEphemeralMessage(`${id} Delete Form Message`, {
      delete_original: true
    }, 'detail.responseUrl')

    const headerBlocks = this.buildHeaderBlocks(title)

    const sendRunningStatusMessage = this.postMessageInChannel(
      `${id} Send Running Status Message to Slack`,
      [...headerBlocks, ...this.buildStatusBlocks('running')]
    )

    const sendFailureStatusMessage = this.updatePostedMessage(
      `${id} Send Failure Status Message to Slack`,
      [...headerBlocks, ...this.buildStatusBlocks('failed'), ...this.buildDetailsBlocks('$.lambdaError.Cause')]
    )

    const sendSuccessStatusMessage = this.updatePostedMessage(
      `${id} Send Success Status Message to Slack`,
      [...headerBlocks, ...this.buildStatusBlocks('success'), ...this.buildDetailsBlocks('$.lambdaResult.Payload')]
    )

    const executeLambdaFunction = new LambdaInvoke(this, `${id} Execute Lambda Function`, {
      lambdaFunction,
      payload: TaskInput.fromObject({ 'input.$': '$.detail.inputValue' }),
      resultPath: '$.lambdaResult'
    })
      .addCatch(sendFailureStatusMessage, {
        errors: ['States.ALL'],
        resultPath: '$.lambdaError'
      })

    const definition = deleteFormMessage
      .next(sendRunningStatusMessage)
      .next(executeLambdaFunction)
      .next(sendSuccessStatusMessage)

    this.buildStateMachineProcessor(id, definition, action)
  }

  private buildStateMachineFormSubmitProcessor(id: string, title: string, action: string, stateMachine: StateMachine) {
    const deleteFormMessage = this.sendEphemeralMessage(`${id} Delete Form Message`, {
      delete_original: true
    }, 'detail.responseUrl')

    const headerBlocks = this.buildHeaderBlocks(title)

    const sendRunningStatusMessage = this.postMessageInChannel(
      `${id} Send Running Status Message to Slack`,
      [...headerBlocks, ...this.buildStatusBlocks('running')]
    )

    const sendFailureStatusMessage = this.updatePostedMessage(
      `${id} Send Failure Status Message to Slack`,
      [...headerBlocks, ...this.buildStatusBlocks('failed'), ...this.buildDetailsBlocks('$.stateMachineError.Cause')]
    )

    const sendSuccessStatusMessage = this.updatePostedMessage(
      `${id} Send Success Status Message to Slack`,
      [...headerBlocks, ...this.buildStatusBlocks('success'), ...this.buildDetailsBlocks('$.stateMachineResult.Output')]
    )

    const executeStateMachine = new StepFunctionsStartExecution(this, `${id} Execute State Machine`, {
      stateMachine,
      integrationPattern: IntegrationPattern.RUN_JOB,
      input: TaskInput.fromObject({
        waitSeconds: 1,
        'input.$': '$.detail.inputValue'
      }),
      resultPath: '$.stateMachineResult'
    })
      .addCatch(sendFailureStatusMessage, {
        errors: ['States.ALL'],
        resultPath: '$.stateMachineError'
      })

    const definition = deleteFormMessage
      .next(sendRunningStatusMessage)
      .next(executeStateMachine)
      .next(sendSuccessStatusMessage)

    this.buildStateMachineProcessor(id, definition, action, false)
  }

  private buildStateMachineProcessor(id: string, definition: IChainable, action: string, express: boolean = true): StateMachine {
    let stateMachine: StateMachine

    if (express) {
      const logGroup = new LogGroup(this, `${id}LogGroup`)

      stateMachine = new StateMachine(this, id, {
        definition,
        stateMachineType: StateMachineType.EXPRESS,
        logs: {
          destination: logGroup,
          level: LogLevel.ALL,
          includeExecutionData: true
        }
      })
    } else {
      stateMachine = new StateMachine(this, id, { definition })
    }

    const rule = new Rule(this, `${id}Rule`, {
      eventBus: this.commandEventBus
    })
    rule.addEventPattern({
      source: ['slack-app'],
      detailType: [action]
    })
    rule.addTarget(new SfnStateMachine(stateMachine))

    return stateMachine
  }

  private buildHeaderBlocks(title: string): any[] {
    return [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: title,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: JsonPath.format('@{} initiated this workflow', JsonPath.stringAt('$.detail.userName'))
        }
      },
      {
        type: 'divider'
      }
    ]
  }

  private buildStatusBlocks(status: 'running' | 'success' | 'failed'): any[] {
    const block = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ''
      }
    }

    if (status === 'running') {
      block.text.text = '▶️ Execution has started...'
    } else if (status === 'success') {
      block.text.text = '✅ Execution was successful!'
    } else {
      block.text.text = '⛔️ Execution has failed. Please see details below'
    }

    return [block]
  }

  private buildDetailsBlocks(contentPath: string): any[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Response Details*'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: JsonPath.format('```{}```', JsonPath.stringAt(contentPath))
        }
      }
    ]
  }
}
