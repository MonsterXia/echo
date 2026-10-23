import { Target } from 'hdckit'

// hdckit 0.12.1 getParameters() discards non-parameter output, including
// explicit command errors. Validate the raw response before parsing it.
export async function getTargetParameters(target: Target) {
  const connection = await target.shell('param get')
  try {
    return parseTargetParameters((await connection.readAll()).toString())
  } finally {
    connection.end()
  }
}

// Share parsing with finite overview reads without changing enumeration transport.
export function parseTargetParameters(output: string): Record<string, string> {
  if (/^\s*(?:\[Fail\]|\[E\d{6}\]|error:)/im.test(output)) {
    // Do not put the raw response (which may contain private data) in errors.
    throw new Error('HDC parameter command failed')
  }
  const parameters: Record<string, string> = Object.create(null)
  for (const match of output.matchAll(/^\s*([^\r\n]*?) = ([^\r\n]*)\r?$/gm)) {
    parameters[match[1]] = match[2]
  }
  return parameters
}
