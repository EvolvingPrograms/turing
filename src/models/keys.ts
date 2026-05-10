import { readFile } from "fs/promises"
import { homedir } from "os"
import { join } from "path"

const { ANTHROPIC_API_KEY, OPENAI_API_KEY } = process.env

export async function getAnthropicKey() {
  if (ANTHROPIC_API_KEY) {
    return ANTHROPIC_API_KEY
  }

  const keyPath = join(homedir(), ".config", "anthropic.token")
  return (await readFile(keyPath, "utf8")).trim()
}

export async function getOpenAIKey() {
  if (OPENAI_API_KEY) {
    return OPENAI_API_KEY
  }

  const keyPath = join(homedir(), ".config", "openai.token")
  return (await readFile(keyPath, "utf8")).trim()
}
