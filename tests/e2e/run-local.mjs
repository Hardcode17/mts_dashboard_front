import {execFileSync, spawn} from 'node:child_process'
import {randomBytes, randomUUID} from 'node:crypto'
import {copyFile, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'

const root = fileURLToPath(new URL('../../', import.meta.url))
const backend = resolve(root, process.env.MCC_E2E_BACKEND_DIR || '../mts_dashboard_backend')
const project = 'mcc-kan73-' + randomBytes(5).toString('hex')
const directory = await mkdtemp(join(tmpdir(), project + '-'))
const randomSecret = () => randomBytes(24).toString('hex')
const username = 'coordinator'
const password = randomSecret()
const senderSecret = randomSecret()
const subject = randomUUID()
const runtimeFile = join(directory, 'backend.env')
const realmFile = join(directory, 'dashboard-realm.json')

function spawnCommand(program, args, options) {
  const {input, ...settings} = options
  const child = spawn(program, args, {...settings, stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit']})
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(
      new Error(`${program} ${args[0]} failed: ${signal || code}`),
    ))
    if (input) {
      child.stdin.on('error', reject)
      child.stdin.end(input)
    }
  })
  return {child, finished}
}

async function localPorts() {
  const sockets = []
  try {
    // Hold all four listeners until their addresses have been selected.
    for (let index = 0; index < 4; index++) {
      const socket = createServer()
      await new Promise((ready, reject) => socket.once('error', reject).listen(0, '127.0.0.1', ready))
      sockets.push(socket)
    }
    return sockets.map(socket => socket.address().port)
  } finally {
    await Promise.all(sockets.map(socket => new Promise(done => socket.close(done))))
  }
}

async function waitFor(url) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(3000)}).catch(() => null)
    if (response?.ok) return
    await delay(1000)
  }
  throw new Error(`Local service did not become ready: ${url}`)
}

const run = (program, args, options) => spawnCommand(program, args, options).finished
let compose
let gateway
let gatewayDone
let composeStarted = false

try {
  const dockerEndpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT ? process.env.DOCKER_HOST
    : execFileSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {encoding: 'utf8'}).trim()
  if (!/^(?:unix|npipe):\/\//.test(dockerEndpoint)) {
    throw new Error('The KAN-73 runner requires a local Docker socket; remote contexts are not allowed.')
  }
  const [frontendPort, backendPort, keycloakPort, itsmPort] = await localPorts()
  const frontendUrl = `http://127.0.0.1:${frontendPort}`
  const backendUrl = `http://127.0.0.1:${backendPort}`
  const keycloakUrl = `http://127.0.0.1:${keycloakPort}`
  const itsmUrl = `http://127.0.0.1:${itsmPort}`
  const authority = keycloakUrl + '/realms/dashboard'
  const backendEnv = {
    POSTGRES_PASSWORD: randomSecret(),
    SPRING_SECURITY_USER_PASSWORD: randomSecret(),
    KEYCLOAK_ADMIN_PASSWORD: randomSecret(),
    KEYCLOAK_ADMIN_USERNAME: 'admin',
    BACKEND_ENV_FILE: runtimeFile,
    BACKEND_PROFILE: 'demo',
    BACKEND_PORT: String(backendPort),
    AUTH_REALM_FILE: realmFile,
    MCC_E2E_KEYCLOAK_PORT: String(keycloakPort),
    MCC_E2E_FIXTURE_FILE: join(root, 'tests/e2e/itsm-fixture.json'),
    STAND_KEYCLOAK_URL: keycloakUrl,
    APP_AUTH_HUMAN_ISSUER: authority,
    APP_AUTH_HUMAN_JWK_SET_URI: 'http://keycloak:8080/realms/dashboard/protocol/openid-connect/certs',
    APP_AUTH_HUMAN_AUDIENCE: 'dashboard-api',
    APP_CORS_ALLOWED_ORIGINS: frontendUrl,
    ITSM_INTEGRATION_AUTH_ISSUER: authority,
    ITSM_INTEGRATION_AUTH_JWK_SET_URI: 'http://keycloak:8080/realms/dashboard/protocol/openid-connect/certs',
    ITSM_INTEGRATION_AUTH_AUDIENCE: 'itsm-ingest',
    ITSM_INTEGRATION_AUTH_CLIENT_ID: 'itsm-sender',
    ITSM_MOCK_PORT: String(itsmPort),
    ITSM_MOCK_SCHEDULED: 'false',
    ITSM_MOCK_SOURCE_ID: 'kan73-frontend-e2e',
    ITSM_MOCK_FIXTURE_FILE: '/kan73-itsm-fixture.json',
    ITSM_MOCK_TARGET_URL: 'http://backend:8080/api/integrations/itsm/batches',
    ITSM_MOCK_TOKEN_URL: 'http://keycloak:8080/realms/dashboard/protocol/openid-connect/token',
    ITSM_MOCK_CLIENT_ID: 'itsm-sender',
    ITSM_MOCK_CLIENT_SECRET: senderSecret,
    DASHBOARD_ITSM_BASE_URL: 'http://itsm-mock:8080',
    DASHBOARD_ITSM_LINK_TEMPLATE: itsmUrl + '/itsm_incident/{incidentId}/page',
    DASHBOARD_ITSM_LINK_DEMO: 'true',
  }
  await writeFile(runtimeFile, Object.entries(backendEnv).map(([key, value]) => `${key}=${value}`).join('\n') + '\n',
    {mode: 0o600})
  await run('java', ['scripts/RenderRealm.java', 'src/keycloak/realm/dashboard-realm.json', realmFile], {
    cwd: backend,
    env: {...process.env, DASHBOARD_TEST_USERNAME: username, DASHBOARD_TEST_PASSWORD: password,
      DASHBOARD_TEST_EMAIL: 'coordinator@example.invalid', ITSM_SENDER_CLIENT_SECRET: senderSecret,
      DASHBOARD_WEB_ORIGIN: frontendUrl},
  })
  const realm = JSON.parse(await readFile(realmFile, 'utf8'))
  realm.users.find(user => user.username === username).id = subject
  await writeFile(realmFile, JSON.stringify(realm))

  const backendJar = process.env.MCC_E2E_BACKEND_JAR
  const itsmJar = process.env.MCC_E2E_ITSM_JAR
  if (Boolean(backendJar) !== Boolean(itsmJar)) {
    throw new Error('Set both MCC_E2E_BACKEND_JAR and MCC_E2E_ITSM_JAR, or neither.')
  }
  const overlays = ['-f', join(root, 'tests/e2e/compose.local.yaml')]
  if (backendJar && itsmJar) {
    // Keep the running containers independent of another local Gradle build.
    backendEnv.MCC_E2E_BACKEND_JAR = join(directory, 'backend.jar')
    backendEnv.MCC_E2E_ITSM_JAR = join(directory, 'itsm-mock.jar')
    await Promise.all([
      copyFile(resolve(backend, backendJar), backendEnv.MCC_E2E_BACKEND_JAR),
      copyFile(resolve(backend, itsmJar), backendEnv.MCC_E2E_ITSM_JAR),
    ])
    overlays.push('-f', join(root, 'tests/e2e/compose.jars.yaml'))
  }
  compose = (args, input) => run('docker', [
    'compose', '--project-name', project, '--env-file', runtimeFile, '-f', 'compose.yaml', ...overlays,
    '--profile', 'itsm-mock', ...args,
  ], {cwd: backend, env: {...process.env, ...backendEnv}, input})
  await run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn',
    '--emptyOutDir', '--outDir', join(directory, 'dist')],
    {cwd: root, env: {...process.env, VITE_BACKEND_MODE: 'real', VITE_OIDC_AUTHORITY: authority, VITE_API_URL: '',
      VITE_ROUTING_ADVISOR_ENABLED: 'false'}})
  console.log(`Starting isolated Compose project ${project}`)
  composeStarted = true
  await compose(['up', backendJar ? '--no-build' : '--build', '--detach', '--wait', '--wait-timeout', '240'])
  await Promise.all([waitFor(backendUrl + '/health'), waitFor(itsmUrl + '/api/mock/status'),
    waitFor(authority + '/.well-known/openid-configuration')])
  await compose(['exec', '-T', 'postgres', 'psql', '-U', 'dashboard', '-d', 'dashboard',
    '-v', `issuer=${authority}`, '-v', `subject=${subject}`, '-v', `login=${username}`,
    '-v', 'display_name=KAN-73 Test Coordinator'], await readFile(join(backend, 'scripts/grant-coordinator.sql')))

  const server = spawnCommand(process.execPath, [join(root, 'server/start.mjs')], {
    cwd: directory, env: {...process.env, PORT: String(frontendPort), BACKEND_URL: backendUrl, KEYCLOAK_URL: ''},
  })
  gateway = server.child
  gatewayDone = server.finished.catch(error => { if (!gateway.killed) console.error(error.message) })
  await waitFor(frontendUrl + '/health')
  await run(process.execPath, ['--test', 'tests/e2e/real-backend.browser.mjs'], {
    cwd: root,
    env: {...process.env, MCC_E2E_ISOLATED: '1', MCC_E2E_FRONTEND_URL: frontendUrl, MCC_E2E_OIDC_AUTHORITY: authority,
      MCC_E2E_ITSM_URL: itsmUrl, MCC_E2E_USERNAME: username, MCC_E2E_PASSWORD: password},
  })
} catch (error) {
  if (composeStarted) {
    await compose(['exec', '-T', 'postgres', 'psql', '-U', 'dashboard', '-d', 'dashboard', '-c',
      "SELECT source_version,status,diagnostic FROM itsm_ingest_batch WHERE source_id = 'kan73-frontend-e2e'"])
      .catch(() => {})
    await compose(['logs', '--tail', '25', 'backend', 'itsm-mock', 'keycloak']).catch(() => {})
  }
  throw error
} finally {
  gateway?.kill()
  await gatewayDone
  try {
    if (composeStarted) await compose(['down', '--volumes'])
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
}
