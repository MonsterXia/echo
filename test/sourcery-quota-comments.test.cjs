const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const workflowPath = path.join(__dirname, '../.github/workflows/sourcery-quota-comments.yml')
const quotaBody = "Sorry @MonsterXia, you've used your own review budget of 250,000 diff characters for the last 7 days.\n\nYou can request another review in 6 days and 21 hours by commenting `@sourcery-ai review`. [Upgrade](https://app.sourcery.ai/dashboard/billing?connection=github&owner=MonsterXia&from_surface=github_bot&intent=rate_limit_hit) to get a review now."

function fixture() {
  return {
    eventName: 'issue_comment',
    repo: { owner: 'MonsterXia', repo: 'scrcpy-harmony' },
    payload: {
      action: 'created',
      issue: { number: 31, pull_request: { url: 'https://api.github.com/repos/MonsterXia/scrcpy-harmony/pulls/31' } },
      comment: {
        id: 6342925060,
        user: { login: 'sourcery-ai[bot]', type: 'Bot' },
        body: quotaBody,
        issue_url: 'https://api.github.com/repos/MonsterXia/scrcpy-harmony/issues/31',
      },
    },
  }
}

async function run(context, options = {}) {
  // Execute the actual privileged workflow script, with only GitHub I/O replaced.
  const yaml = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n')
  const parts = yaml.split('          script: |\n')
  assert.equal(parts.length, 2)
  const script = parts[1].split('\n').map(line => {
    assert.ok(!line || line.startsWith('            '))
    return line.slice(12)
  }).join('\n')
  assert.ok(!script.includes('${{'), 'untrusted event data must not be interpolated')
  const calls = []
  const github = { rest: { issues: {
    async getComment(args) {
      calls.push(['get', args])
      if (options.getError) throw options.getError
      return { data: options.current || structuredClone(context.payload.comment) }
    },
    async deleteComment(args) {
      calls.push(['delete', args])
      if (options.deleteError) throw options.deleteError
    },
  } } }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  await new AsyncFunction('github', 'context', 'core', script)(github, context, { info() {} })
  return calls
}

for (const action of ['created', 'edited']) {
  test(`deletes the observed quota-only template on ${action}`, async () => {
    const context = fixture()
    context.payload.action = action
    assert.deepEqual(await run(context), [
      ['get', { owner: 'MonsterXia', repo: 'scrcpy-harmony', comment_id: 6342925060 }],
      ['delete', { owner: 'MonsterXia', repo: 'scrcpy-harmony', comment_id: 6342925060 }],
    ])
  })
}

test('accepts another budget, wait duration and CRLF', async () => {
  const context = fixture()
  context.payload.comment.body = quotaBody.replace('250,000', '300,000').replace('6 days and 21 hours', '1 hour').replace(/\n/g, '\r\n')
  assert.equal((await run(context)).length, 2)
})

const preserve = {
  'human author': c => { c.payload.comment.user = { login: 'MonsterXia', type: 'User' } },
  'another bot': c => { c.payload.comment.user.login = 'other[bot]' },
  'non-bot identity': c => { c.payload.comment.user.type = 'User' },
  'ordinary issue': c => { delete c.payload.issue.pull_request },
  'inline review event': c => { c.eventName = 'pull_request_review_comment' },
  'deleted event': c => { c.payload.action = 'deleted' },
  'normal review': c => { c.payload.comment.body = 'issue (bug_risk): Handle failed requests before reading data.' },
  'review guide': c => { c.payload.comment.body = '## Reviewer\'s Guide\n\nReview budget handling changed.' },
  'quota template quoted in review': c => { c.payload.comment.body = 'Review finding:\n' + quotaBody },
  'quota plus real review': c => { c.payload.comment.body += '\n\nissue (bug_risk): This leaks a socket.' },
  'unknown template': c => { c.payload.comment.body = 'Review budget exceeded. Please upgrade.' },
  'missing body': c => { delete c.payload.comment.body },
  'wrong recipient': c => { c.payload.comment.body = quotaBody.replace('@MonsterXia', '@someoneElse') },
  'untrusted billing host': c => { c.payload.comment.body = quotaBody.replace('https://app.sourcery.ai/', 'https://example.com/') },
  'wrong billing intent': c => { c.payload.comment.body = quotaBody.replace('rate_limit_hit', 'review_settings') },
  'wrong billing owner': c => { c.payload.comment.body = quotaBody.replace('owner=MonsterXia', 'owner=someoneElse') },
  'wrong issue URL': c => { c.payload.comment.issue_url += '0' },
}

for (const [name, change] of Object.entries(preserve)) {
  test(`preserves ${name}`, async () => {
    const context = fixture()
    change(context)
    assert.deepEqual(await run(context), [])
  })
}

for (const [name, change] of Object.entries({
  'edited into review': c => { c.body = 'Please check the socket cleanup.' },
  'edited into another quota notice': c => { c.body = c.body.replace('21 hours', '20 hours') },
  'changed author': c => { c.user.login = 'other[bot]' },
  'different issue': c => { c.issue_url += '0' },
  'different comment ID': c => { c.id++ },
})) {
  test(`preserves freshly fetched comment ${name}`, async () => {
    const context = fixture()
    const current = structuredClone(context.payload.comment)
    change(current)
    assert.equal((await run(context, { current })).length, 1)
  })
}

for (const operation of ['getError', 'deleteError']) {
  test(`${operation}: already deleted is harmless`, async () => {
    await run(fixture(), { [operation]: Object.assign(new Error('Not Found'), { status: 404 }) })
  })
  test(`${operation}: permission errors fail visibly`, async () => {
    await assert.rejects(run(fixture(), { [operation]: Object.assign(new Error('Forbidden'), { status: 403 }) }), /Forbidden/)
  })
}
