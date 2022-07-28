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

import { App, AwsLambdaReceiver, LogLevel, RespondFn, SayFn } from "@slack/bolt"
const AWS = require('aws-sdk')
import { buildStatusBlocks, ServiceRequest } from '/opt/nodejs/utils';

AWS.config.update({ region: 'us-east-1' })
const secretsClient = new AWS.SecretsManager()
const ssmClient = new AWS.SSM()
const ddbClient = new AWS.DynamoDB.DocumentClient()
const lambdaClient = new AWS.Lambda();

let awsLambdaReceiver: AwsLambdaReceiver | null = null
let app: App | null = null

type RequestDetails = {
  channelId: string
  userName: string
  permittedActions: string[]
  action: string
  responseUrl?: string
  inputValue?: string
}

exports.handler = async (event: any, context: any, callback: any) => {
  if (!awsLambdaReceiver) {
    await initBolt()
    configureApp()
  }
  const handler = await awsLambdaReceiver!.start()
  return handler(event, context, callback)
}

async function initBolt() {
  // Get the Slack Secrets
  const secretResult = await secretsClient.getSecretValue({ SecretId: process.env.SLACK_SECRETS_NAME }).promise();
  const secretObject = JSON.parse(secretResult.SecretString)

  awsLambdaReceiver = new AwsLambdaReceiver({
    signingSecret: secretObject.signingSecret
  })

  app = new App({
    token: secretObject.botToken,
    receiver: awsLambdaReceiver,
    logLevel: LogLevel.DEBUG
  })
}

function configureApp() {
  if (!app) {
    throw Error('Bolt app not initialized while trying to configure it')
  }

  // @ts-ignore
  app.use(async ({ context, body, ack, next, respond }) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await ack!()

    // Convert body to a consistent format
    const requestDetails = parseRequest(body)

    // Add the request details to the context object
    context.requestDetails = requestDetails

    console.log('middleware context', JSON.stringify(context))

    // Verify Channel
    try {
      await verifySlackChannel(requestDetails.channelId)
    } catch (error: any) {
      console.error('Slack channel verification error', error)
      await respond({ text: 'You are not authorized to use this command here', response_type: 'ephemeral' })
      return
    }

    // Verify User
    try {
      requestDetails.permittedActions = await verifySlackUser(requestDetails.userName)
    } catch (error: any) {
      console.error('Slack user verification error', error)
      await respond({ text: 'You are not authorized to use this command here', response_type: 'ephemeral' })
      return
    }

    // Verify User can perform action
    try {
      verifyUserPermission(requestDetails)
    } catch (error: any) {
      console.error('Slack user permission error', error)
      await respond({ text: 'You are not authorized to use this command here', response_type: 'ephemeral' })
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await next!()
  })

  app.command('/my-slack-bot', async ({ respond }) => {
    await respond(buildWelcomeBlocks())
  })

  app.action('sample-lambda', async ({ body, context, respond }) => {
    console.log('body', body)
    console.log('context', context)

    await respond({
      blocks: buildFormBlocks('Sample Lambda', context.requestDetails.action),
      replace_original: true
    })
  })

  app.action('sample-lambda/submit', async ({ body, context, respond, say }) => {
    console.log('body', body)
    console.log('context', context)

    await handleActionSubmit(context.requestDetails, 'Sample Lambda', respond, say)
  })

  app.action('sample-sfn', async ({ body, context, respond }) => {
    console.log('body', body)
    console.log('context', context)

    await respond({
      blocks: buildFormBlocks('Sample State Machine', context.requestDetails.action),
      replace_original: true
    })
  })

  app.action('sample-sfn/submit', async ({ body, context, respond, say }) => {
    console.log('body', body)
    console.log('context', context)

    await handleActionSubmit(context.requestDetails, 'Sample State Machine', respond, say)
  })
}

function parseRequest(body: any): RequestDetails {
  console.log('body', body)
  if (body.user_id) {
    return {
      channelId: body.channel_id,
      userName: body.user_name,
      permittedActions: [],
      action: 'welcome'
    }
  } else {
    return {
      channelId: body.channel.id,
      userName: body.user.username,
      permittedActions: [],
      action: body.actions[0].action_id,
      responseUrl: body.response_url
    }
  }
}

async function verifySlackChannel(requestChannelId: string) {
  const channelIdParameter = await ssmClient.getParameter({ Name: process.env.CHANNEL_ID_NAME }).promise()
  if (channelIdParameter.Parameter.Value !== requestChannelId) {
    throw new Error('Invalid channel')
  }
}

async function verifySlackUser(userName: string): Promise<string[]> {
  // Find record in table
  const params = {
    TableName: process.env.BOT_USERS_TABLE_NAME,
    KeyConditionExpression: '#name = :name',
    ExpressionAttributeNames: {
      '#name': 'slackUserName'
    },
    ExpressionAttributeValues: {
      ':name': userName
    }
  }
  const response = await ddbClient.query(params).promise()
  if (response.Count === 0) {
    throw new Error('User not found')
  }
  const user = response.Items[0]
  console.log('user', JSON.stringify(user))

  return user.permittedActions
}

function verifyUserPermission(requestDetails: RequestDetails) {
  for (var permittedAction of requestDetails.permittedActions) {
    if (requestDetails.action === 'welcome' || requestDetails.action.startsWith(permittedAction)) {
      return
    }
  }

  throw new Error('User not permitted to perform action')
}

function buildWelcomeBlocks() {
  return {
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
            action_id: 'sample-sfn'
          }
        ]
      }
    ]
  }
}

function buildFormBlocks(title: string, action: string) {
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
  ]
}

function buildHeaderBlocks(title: string, userName: string): any[] {
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
        text: `@${userName} initiated this workflow.`
      }
    },
    {
      type: 'divider'
    },
  ]
}

async function handleActionSubmit(requestDetails: RequestDetails, title: string, respond: RespondFn, say: SayFn) {
  // Create header
  const headerBlocks = buildHeaderBlocks(title, requestDetails.userName);

  // Add status
  const statusBlocks = buildStatusBlocks('running');

  // Remove the ephemeral message
  await respond({ delete_original: true })

  // Post a message to the channel indicating the action is processing
  const response = await say({ blocks: [].concat(...headerBlocks).concat(...statusBlocks) })

  // Build service request details for downstream services
  const serviceRequest: ServiceRequest = {
    action: requestDetails.action,
    channelId: requestDetails.channelId,
    messageTs: response.ts as string,
    headerBlocks: headerBlocks,
    inputValue: requestDetails.inputValue!
  }

  // Trigger service trigger with request details (including input)
  await lambdaClient.invokeAsync({
    FunctionName: process.env.SERVICE_TRIGGER_NAME,
    InvokeArgs: JSON.stringify(serviceRequest)
  }).promise();
}
