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

import { buildStatusBlocks, ServiceRequest } from "./shared/nodejs/utils";
import * as axios from 'axios';
const AWS = require('aws-sdk');

AWS.config.update({region: 'us-east-1'});
const secretsClient = new AWS.SecretsManager();
const lambdaClient = new AWS.Lambda();
const sfnClient = new AWS.StepFunctions();

exports.handler = async function(serviceRequest: ServiceRequest, context: any) {
  console.log('serviceRequest', JSON.stringify(serviceRequest));

  // Get the Bot Token Secret
  const secretResult = await secretsClient.getSecretValue({SecretId: process.env.BOT_TOKEN_NAME}).promise();

  // Route action
  if (serviceRequest.action === 'sample-lambda/submit') {
    try {
      const result = await lambdaClient.invoke({
        FunctionName: process.env.SAMPLE_LAMBDA_NAME,
        Payload: JSON.stringify({input: serviceRequest.inputValue})
      }).promise();

      await handleServiceSuccess(result.Payload, serviceRequest, secretResult.SecretString);
    } catch (error: any) {
      await handleServiceError(error, serviceRequest, secretResult.SecretString)
    }
  } else if (serviceRequest.action === 'sample-sfn/submit') {
    try {
      const result = await sfnClient.startExecution({
        stateMachineArn: process.env.SAMPLE_SFN_ARN,
        input: JSON.stringify({
          waitSeconds: 1,
          input: serviceRequest.inputValue
        })
      }).promise();
      var execution = await sfnClient.describeExecution({
        executionArn: result.executionArn
      }).promise();

      while (execution.status === 'RUNNING') {
        await new Promise((resolve) => {
          setTimeout(() => {
            resolve(true);
          }, 500)
        });
        execution = await sfnClient.describeExecution({
          executionArn: result.executionArn
        }).promise();
      }

      if (execution.status !== 'SUCCEEDED') {
        throw new Error(execution.output);
      }
      
      await handleServiceSuccess(execution.output, serviceRequest, secretResult.SecretString)
    } catch (error: any) {
      await handleServiceError(error, serviceRequest, secretResult.SecretString)
    }
  } else {
    throw new Error('Unhandled action received')
  }
};

async function handleServiceSuccess(content: any, serviceRequest: ServiceRequest, botTokenSecret: string) {
  // Build status block
  const statusBlocks = buildStatusBlocks('success');

  // Build details blocks
  const detailsBlocks = buildDetailsBlock('```' + content + '```');

  // Post message in Slack channel indicating request in progress
  const response = await axios.default.post('https://slack.com/api/chat.update', {
    channel: serviceRequest.channelId,
    ts: serviceRequest.messageTs,
    blocks: [].concat(...serviceRequest.headerBlocks).concat(...statusBlocks).concat(...detailsBlocks)
  }, {
    headers: {
      Authorization: `Bearer ${botTokenSecret}`
    }
  });
  if (!response.data.ok) {
    throw new Error('Failed to update message in Slack channel')
  }
}

function buildDetailsBlock(content: string): any[] {
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
        text: content
      }
    }
  ]
}

async function handleServiceError(error: any, serviceRequest: ServiceRequest, botTokenSecret: string) {
  console.error('Service execution failure', error)
  // Build status block
  const statusBlocks = buildStatusBlocks('failed');

  // Build error details blocks
  const errorDetailsBlocks = buildDetailsBlock('```' + error.message + '```');

  // Post message in Slack channel indicating request in progress
  const response = await axios.default.post('https://slack.com/api/chat.update', {
    channel: serviceRequest.channelId,
    ts: serviceRequest.messageTs,
    blocks: [].concat(...serviceRequest.headerBlocks).concat(...statusBlocks).concat(...errorDetailsBlocks)
  }, {
    headers: {
      Authorization: `Bearer ${botTokenSecret}`
    }
  });
  if (!response.data.ok) {
    throw new Error('Failed to update message in Slack channel')
  }
}
