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

import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Pass, Result, StateMachine, Succeed, Wait, WaitTime } from 'aws-cdk-lib/aws-stepfunctions';

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Secrets and Parameters
    const signingSecret = new Secret(this, 'SlackSigningSecret');
    const botTokenSecret = new Secret(this, 'SlackBotTokenSecret');
    const slackChannelParameter = new StringParameter(this, 'SlackChannelIdParameter', {
      parameterName: 'SlackChannelIdParameter',
      description: 'The permitted slack channel ID for Slack Bot requets',
      stringValue: '<TODO: ADD YOUR CHANNEL ID (EX: A012BCCDEFG)>'
    });

    // DB Tables
    const botUsersTable = new Table(this, 'BotUsersTable', {
      billingMode: BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1,
      removalPolicy: RemovalPolicy.DESTROY,
      partitionKey: {name: 'slackUserName', type: AttributeType.STRING}
    });

    // Step Functions
    const sampleStateMachine = this.buildStateMachine();

    // Lambda Layers
    const layer = new LayerVersion(this, 'shared-layer', {
      compatibleRuntimes: [
        Runtime.NODEJS_12_X,
        Runtime.NODEJS_14_X,
      ],
      code: Code.fromAsset('lib/shared')
    });

    // Lambda Functions
    const bundlingConfig = {
      externalModules: [
        'aws-sdk'
      ]
    };
    const sampleLambdaFunction = new NodejsFunction(this, 'sample-lambda-function');

    const serviceTrigger = new NodejsFunction(this, 'service-trigger', {
      environment: {
        BOT_TOKEN_NAME: botTokenSecret.secretName,
        SAMPLE_LAMBDA_NAME: sampleLambdaFunction.functionName,
        SAMPLE_SFN_ARN: sampleStateMachine.stateMachineArn
      },
      bundling: bundlingConfig,
      layers: [layer]
    });
  
    const commandProcessor = new NodejsFunction(this, 'command-processor', {
      environment: {
        SIGNING_SECRET_NAME: signingSecret.secretName,
        BOT_TOKEN_NAME: botTokenSecret.secretName,
        CHANNEL_ID_NAME: slackChannelParameter.parameterName,
        BOT_USERS_TABLE_NAME: botUsersTable.tableName,
        SERVICE_TRIGGER_NAME: serviceTrigger.functionName
      },
      bundling: bundlingConfig,
      layers: [layer]
    });

    // Grant Permissions
    signingSecret.grantRead(commandProcessor);
    botTokenSecret.grantRead(commandProcessor);
    botTokenSecret.grantRead(serviceTrigger);
    slackChannelParameter.grantRead(commandProcessor);
    botUsersTable.grantReadData(commandProcessor);
    serviceTrigger.grantInvoke(commandProcessor);
    sampleLambdaFunction.grantInvoke(serviceTrigger);
    sampleStateMachine.grantStartExecution(serviceTrigger);
    sampleStateMachine.grantRead(serviceTrigger);

    // API Gateway
    const api = new RestApi(this, "slack-bot-api", {
      restApiName: "Slack Bot Starter Kit API",
      description: "This is the API service Slack Bot Starter Kit."
    });
    // POST /
    api.root.addMethod("POST", new LambdaIntegration(commandProcessor, {
      requestTemplates: { "application/json": '{ "statusCode": "200" }' },
    }));
  }

  private buildStateMachine() {
    const waitX = new Wait(this, 'Wait X Seconds', {
      time: WaitTime.secondsPath('$.waitSeconds'),
    });
    const pass = new Pass(this, 'Add Result', {
      result: Result.fromString('some result'),
      resultPath: '$.result',
    });
    const jobSuccess = new Succeed(this, 'Job Succcess');
    const definition = waitX.next(pass).next(jobSuccess);

    return new StateMachine(this, 'SampleStateMachine', { definition });
  }
}
