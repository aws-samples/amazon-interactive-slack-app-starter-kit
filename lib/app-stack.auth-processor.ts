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

const secretsClient = new AWS.SecretsManager()

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
