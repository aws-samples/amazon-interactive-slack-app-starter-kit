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

import { createHmac } from 'crypto';
import * as axios from 'axios';
import { buildStatusBlocks, ServiceRequest } from '/opt/nodejs/utils';
const tsscmp = require('tsscmp');
const AWS = require('aws-sdk');

AWS.config.update({region: 'us-east-1'});
const secretsClient = new AWS.SecretsManager();
const ssmClient = new AWS.SSM();
const ddbClient = new AWS.DynamoDB.DocumentClient();
const lambdaClient = new AWS.Lambda();

type RequestDetails = {
  channelId: string
  userName: string
  permittedActions: string[]
  action: string
  responseUrl?: string
  inputValue?: string
}

exports.handler = async function(event: any, context: any) {
  // Verify Slack Request
  try {
    await verifySlackRequest(event)
  } catch (error: any) {
    console.error('Slack verification error', error)
    return generateResponse('Slack verification failure: ' + error);
  }

  // Convert body to a consistent format
  const requestDetails = parseRequest(event)

  // Verify Channel
  try {
    await verifySlackChannel(requestDetails.channelId);
  } catch (error: any) {
    console.error('Slack channel verification error', error);
    return generateResponse('You are not authorized to use this command here');
  }

  // Verify User
  try {
    requestDetails.permittedActions = await verifySlackUser(requestDetails.userName);
  } catch (error: any) {
    console.error('Slack user verification error', error)
    return generateResponse('You are not authorized to use this command here');
  }

  // Verify User can perform action
  try {
    verifyUserPermission(requestDetails)
  } catch (error: any) {
    console.error('Slack user permission error', error);
    return generateResponse('You are not authorized to use this command here');
  }

  // Process command
  try {
    const response = await processCommand(requestDetails)
    return generateResponse(JSON.stringify(response))
  } catch (error: any) {
    console.error('Failed to process command', error);
    return generateResponse('Failed to process request. Please try again later');
  }
}

function generateResponse(body: string) {
  return {
    statusCode: 200,
    headers: {},
    body: body
  };
}

function parseRequest(event: any): RequestDetails {
  if (event.body.startsWith('payload')) { // Process payload requests
    const bodyJson = queryStringToJSON(event.body);
    const payloadJson = JSON.parse(bodyJson.payload)
    console.log('payloadJson', JSON.stringify(payloadJson))
    return {
      channelId: payloadJson.channel.id,
      userName: payloadJson.user.username,
      permittedActions: [],
      action: payloadJson.actions[0].value,
      responseUrl: payloadJson.response_url,
      inputValue: payloadJson.state.values.form_input ? payloadJson.state.values.form_input.input_value.value : undefined
    }
  } else { // Process statndard requests
    const bodyJson = queryStringToJSON(event.body)
    return {
      channelId: bodyJson.channel_id,
      userName: bodyJson.user_name,
      permittedActions: [],
      action: 'welcome'
    }
  }
}

function queryStringToJSON(queryString: string) {
  var result: any = {};
  queryString.split('&').forEach(function(pair: string) {
      const pairList = pair.split('=');
      result[pairList[0]] = decodeURIComponent(pairList[1] || '');
  });
  return JSON.parse(JSON.stringify(result));
}

// Pulled from https://github.com/slackapi/bolt-js/blob/main/src/receivers/verify-request.ts
async function verifySlackRequest(event: any) {
  const requestTimestampSec = event.headers['X-Slack-Request-Timestamp'];
  const signature = event.headers['X-Slack-Signature'];
  if (Number.isNaN(requestTimestampSec)) {
    throw new Error(
      `Header X-Slack-Request-Timestamp did not have the expected type (${requestTimestampSec})`,
    );
  }

  // Calculate time-dependent values
  const nowMs = Date.now();
  const fiveMinutesAgoSec = Math.floor(nowMs / 1000) - 60 * 5;

  // Enforce verification rules

  // Rule 1: Check staleness
  if (requestTimestampSec < fiveMinutesAgoSec) {
    throw new Error('Stale request');
  }

  // Rule 2: Check signature
  // Separate parts of signature
  const [signatureVersion, signatureHash] = signature.split('=');
  // Only handle known versions
  if (signatureVersion !== 'v0') {
    throw new Error('Unknown signature version');
  }
  // Get the Slack Signing Secret
  const secretResult = await secretsClient.getSecretValue({SecretId: process.env.SIGNING_SECRET_NAME}).promise();
  // Compute our own signature hash
  const hmac = createHmac('sha256', secretResult.SecretString);
  hmac.update(`${signatureVersion}:${requestTimestampSec}:${event.body}`);
  const ourSignatureHash = hmac.digest('hex');
  if (!signatureHash || !tsscmp(signatureHash, ourSignatureHash)) {
    throw new Error('Signature mismatch');
  }
}

async function verifySlackChannel(requestChannelId: string) {
  const channelIdParameter = await ssmClient.getParameter({Name: process.env.CHANNEL_ID_NAME}).promise();
  if (channelIdParameter.Parameter.Value !== requestChannelId) {
    throw new Error('Invalid channel')
  }
}

async function verifySlackUser(userName: string): Promise<string[]> {
  // Find record in table
  const params = {
    TableName : process.env.BOT_USERS_TABLE_NAME,
    KeyConditionExpression: '#name = :name',
    ExpressionAttributeNames:{
        '#name': 'slackUserName'
    },
    ExpressionAttributeValues: {
        ':name': userName
    }
  };
  const response = await ddbClient.query(params).promise();
  if (response.Count === 0) {
    throw new Error('User not found')
  }
  const user = response.Items[0]
  console.log('user', JSON.stringify(user));

  return user.permittedActions
}

function verifyUserPermission(requestDetails: RequestDetails) {
  for (var permittedAction of requestDetails.permittedActions) {
    if (requestDetails.action === 'welcome' || requestDetails.action.startsWith(permittedAction)) {
      return;
    }
  }

  throw new Error('User not permitted to perform action')
}

async function processCommand(requestDetails: RequestDetails): Promise<any> {
  console.log('processCommand', JSON.stringify(requestDetails))

  if (requestDetails.action === 'welcome') {
    return buildWelcomeBlocks();
  } else if (requestDetails.action === 'sample-lambda') {
    // Update ephemeral message with simple form input
    await axios.default.post(requestDetails.responseUrl!, {
      replace_original: true,
      blocks: buildFormBlocks('Sample Lambda', requestDetails.action)
    });
  } else if (requestDetails.action === 'sample-lambda/submit') {
    await handleActionSubmit(requestDetails, 'Sample Lambda')
  } else if (requestDetails.action === 'sample-sfn') {
    // Update ephemeral message with simple form input
    await axios.default.post(requestDetails.responseUrl!, {
      replace_original: true,
      blocks: buildFormBlocks('Sample State Machine', requestDetails.action)
    });
  } else if (requestDetails.action === 'sample-sfn/submit') {
    await handleActionSubmit(requestDetails, 'Sample State Machine')
  } else {
    throw new Error('Unhandled action received')
  }

  return {}
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
            value: 'sample-lambda'
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Sample State Machine',
              emoji: true
            },
            value: 'sample-sfn'
          }
        ]
      }
    ]
  }
}

async function handleActionSubmit(requestDetails: RequestDetails, title: string) {
  // Create header
  const headerBlocks = buildHeaderBlocks(title, requestDetails.userName);

  // Add status
  const statusBlocks = buildStatusBlocks('running');

  // Get the Bot Token Secret
  const secretResult = await secretsClient.getSecretValue({SecretId: process.env.BOT_TOKEN_NAME}).promise();

  // Post message in Slack channel indicating request in progress
  const response = await axios.default.post('https://slack.com/api/chat.postMessage', {
    channel: requestDetails.channelId,
    blocks: [].concat(...headerBlocks).concat(...statusBlocks)
  }, {
    headers: {
      Authorization: `Bearer ${secretResult.SecretString}`
    }
  });
  if (!response.data.ok) {
    throw new Error('Failed to post message to Slack channel')
  }

  // Delete original message
  await axios.default.post(requestDetails.responseUrl!, {
    delete_original: true
  });

  // Build service request details for downstream services
  const serviceRequest: ServiceRequest = {
    action: requestDetails.action,
    channelId: requestDetails.channelId,
    messageTs: response.data.ts,
    headerBlocks: headerBlocks,
    inputValue: requestDetails.inputValue!
  }

  // Trigger service trigger with request details (including input)
  await lambdaClient.invokeAsync({
    FunctionName: process.env.SERVICE_TRIGGER_NAME,
    InvokeArgs: JSON.stringify(serviceRequest)
  }).promise();
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
