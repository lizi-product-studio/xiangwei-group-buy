import process from 'node:process';
import { rootCertificates } from 'node:tls';
import { readFile, writeFile, access } from 'node:fs/promises';

if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Browser image setup requires Linux root');
const configPath = '/etc/apt/apt.conf.d/99-readiness-https';
if (process.argv[2] === '--system-ca') {
  await access('/etc/ssl/certs/ca-certificates.crt');
  const config = await readFile(configPath, 'utf8');
  await writeFile(configPath, config.replace('/tmp/readiness-bootstrap-ca.pem', '/etc/ssl/certs/ca-certificates.crt'));
} else {
  if (process.argv.length !== 2 || rootCertificates.length < 1) throw new Error('Unexpected browser setup arguments or unavailable bundled trust roots');
  // Bootstrap HTTPS using the Node release's bundled public roots, not an
  // unauthenticated download. Debian archive signature checks remain enabled.
  await writeFile('/tmp/readiness-bootstrap-ca.pem', `${rootCertificates.join('\n')}\n`, { mode: 0o644 });
  const sourcesPath = '/etc/apt/sources.list.d/debian.sources';
  const sources = await readFile(sourcesPath, 'utf8');
  if (!sources.includes('Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg') || /Trusted:|Allow-Insecure:|Allow-Weak:|Check-Valid-Until:\s*no/i.test(sources)) throw new Error('Unexpected Debian archive trust configuration');
  const updated = sources.replace(/^URIs:[ \t]+https?:\/\/deb\.debian\.org\/debian(-security)?\/?[ \t]*$/gm,
    (_line, security) => `URIs: https://mirrors.tuna.tsinghua.edu.cn/debian${security ?? ''}`);
  const uris = updated.split('\n').filter(line => line.startsWith('URIs:'));
  if (uris.length !== 2 || uris.some(line => !/^URIs: https:\/\/mirrors\.tuna\.tsinghua\.edu\.cn\/debian(-security)?$/.test(line))) throw new Error('Unexpected Debian source endpoints');
  await writeFile(sourcesPath, updated);
  await writeFile(configPath, 'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "2";\nAcquire::https::CaInfo "/tmp/readiness-bootstrap-ca.pem";\nAcquire::https::Verify-Peer "true";\nAcquire::https::Verify-Host "true";\nAPT::Get::AllowUnauthenticated "false";\nAcquire::AllowInsecureRepositories "false";\nAcquire::AllowDowngradeToInsecureRepositories "false";\n');
}
