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

import { SecretsManager } from 'aws-sdk'
import * as axios from 'axios'

const secretsClient = new SecretsManager()

type HttpClientParameters = {
  url: string,
  body: any
}

exports.handler = async function (parameters: HttpClientParameters, context: any) {
  // Get the Bot Token Secret
  const secretResult = await secretsClient.getSecretValue({ SecretId: process.env.SLACK_SECRETS_NAME as string }).promise()
  const secretObject = JSON.parse(secretResult.SecretString as string)

  const headers = { Authorization: `Bearer ${secretObject.botToken}` }

  // Post message in Slack channel
  const response = await axios.default.post(parameters.url, parameters.body, { headers })
  if (response.data === 'ok' || response.data.ok) {
    return response.data
  }

  throw new Error('Failed to update message in Slack channel')
}
