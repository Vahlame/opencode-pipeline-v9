import type { AppConfig } from '../config/env.js'
import { parseModelRef } from '../config/env.js'
import type { OpenCodeAdapter } from './adapter.js'
import { HttpOpenCodeAdapter } from './http-adapter.js'
import { MockOpenCodeAdapter } from './mock-adapter.js'
import { SdkOpenCodeAdapter } from './sdk-adapter.js'

export async function createOpenCodeAdapter(config: AppConfig): Promise<OpenCodeAdapter> {
  switch (config.OPENCODE_RUNTIME) {
    case 'mock':
      return new MockOpenCodeAdapter()
    case 'sdk':
      return SdkOpenCodeAdapter.create({
        ...(config.OPENCODE_SDK_DATA_DIR ? { dataDir: config.OPENCODE_SDK_DATA_DIR } : {}),
      })
    case 'http':
      return HttpOpenCodeAdapter.create({
        ...(config.OPENCODE_BASE_URL ? { baseUrl: config.OPENCODE_BASE_URL } : {}),
        ...(config.OPENCODE_PASSWORD ? { password: config.OPENCODE_PASSWORD } : {}),
      })
  }
}

export function modelFromConfig(config: AppConfig) {
  return parseModelRef(config.OPENCODE_MODEL)
}
