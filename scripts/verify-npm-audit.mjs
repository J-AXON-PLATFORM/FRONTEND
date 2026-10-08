import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const advisory = "GHSA-vfj7-8cjw-p6xm";
const cve = "CVE-2026-93687";
const expectedVulnerabilities = new Map([
  ["braces", { direct: false, via: advisory }],
  ["micromatch", { direct: false, via: "braces" }],
  ["fast-glob", { direct: false, via: "micromatch" }],
  ["@next/eslint-plugin-next", { direct: false, via: "fast-glob" }],
  ["eslint-config-next", { direct: true, via: "@next/eslint-plugin-next" }],
]);
const expectedChain = [
  ["eslint-config-next", "16.3.8", "@next/eslint-plugin-next", "16.3.8"],
  ["@next/eslint-plugin-next", "16.3.8", "fast-glob", "3.3.1"],
  ["fast-glob", "3.3.1", "micromatch", "^4.0.4"],
  ["micromatch", "4.0.8", "braces", "^3.0.3"],
  ["braces", "3.0.3", null, null],
];

function fail(message) {
  console.error(`Dependency audit verification failed: ${message}`);
  process.exit(1);
}

function parseJson(value, source) {
  try {
    return JSON.parse(value);
  } catch {
    fail(`${source} did not return valid JSON.`);
  }
}

function runNpm(arguments_) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    fail("npm_execpath is unavailable; run this verifier through npm.");
  }

  const result = spawnSync(process.execPath, [npmCli, ...arguments_], {
    encoding: "utf8",
    env: { ...process.env, npm_config_color: "false" },
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error) {
    fail(`npm ${arguments_.join(" ")} could not start: ${result.error.message}`);
  }
  if (result.signal) {
    fail(`npm ${arguments_.join(" ")} ended from signal ${result.signal}.`);
  }

  return result;
}

function containsDependency(node, name) {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (Object.hasOwn(node.dependencies ?? {}, name)) {
    return true;
  }
  return Object.values(node.dependencies ?? {}).some((dependency) =>
    containsDependency(dependency, name),
  );
}

const packageJson = parseJson(readFileSync("package.json", "utf8"), "package.json");
const directSections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
if (directSections.some((section) => Object.hasOwn(packageJson[section] ?? {}, "braces"))) {
  fail("braces must not be a direct dependency.");
}

const productionTreeResult = runNpm(["ls", "braces", "--omit=dev", "--all", "--json"]);
const productionTree = parseJson(productionTreeResult.stdout, "npm production tree");
// npm ls returns 1 when a requested package is absent, which is the expected result here.
if (
  ![0, 1].includes(productionTreeResult.status) ||
  productionTree.error ||
  productionTree.problems
) {
  fail("the production dependency tree could not be verified.");
}
if (containsDependency(productionTree, "braces")) {
  fail("braces is present in the production dependency tree.");
}

const auditResult = runNpm(["audit", "--json"]);
const audit = parseJson(auditResult.stdout, "npm audit");
if (audit.error || audit.auditReportVersion !== 2 || !audit.vulnerabilities || !audit.metadata) {
  fail("npm audit returned an error or an unsupported report structure.");
}

const vulnerabilityNames = Object.keys(audit.vulnerabilities);
if (vulnerabilityNames.length === 0) {
  if (auditResult.status !== 0 || audit.metadata.vulnerabilities?.total !== 0) {
    fail("npm audit reported inconsistent clean results.");
  }
  console.log("Dependency audit is clean; no exception is required.");
  process.exit(0);
}

if (auditResult.status === 0) {
  fail("npm audit reported vulnerabilities with a successful exit code.");
}
if (auditResult.status !== 1) {
  fail(`npm audit failed with unexpected exit code ${auditResult.status}.`);
}

const expectedNames = [...expectedVulnerabilities.keys()].sort();
if (
  vulnerabilityNames.length !== expectedNames.length ||
  vulnerabilityNames.sort().some((name, index) => name !== expectedNames[index])
) {
  fail(`unexpected vulnerable packages: ${vulnerabilityNames.join(", ")}.`);
}

for (const [name, expected] of expectedVulnerabilities) {
  const vulnerability = audit.vulnerabilities[name];
  if (vulnerability.severity !== "high" || vulnerability.isDirect !== expected.direct) {
    fail(`${name} has an unexpected severity or direct-dependency status.`);
  }

  const actualVia = vulnerability.via.map((entry) =>
    typeof entry === "string" ? entry : entry.url?.split("/").at(-1),
  );
  if (actualVia.length !== 1 || actualVia[0] !== expected.via) {
    fail(`${name} has an unexpected advisory path.`);
  }
}

const advisoryDetails = audit.vulnerabilities.braces.via[0];
if (
  typeof advisoryDetails !== "object" ||
  advisoryDetails.name !== "braces" ||
  advisoryDetails.severity !== "high" ||
  advisoryDetails.url !== `https://github.com/advisories/${advisory}` ||
  advisoryDetails.range !== "<=3.0.3"
) {
  fail(`the ${advisory} advisory metadata changed.`);
}

const counts = audit.metadata.vulnerabilities;
if (
  counts.total !== 5 ||
  counts.high !== 5 ||
  counts.info !== 0 ||
  counts.low !== 0 ||
  counts.moderate !== 0 ||
  counts.critical !== 0
) {
  fail("npm audit contains vulnerabilities outside the approved exception.");
}

const packageLock = parseJson(readFileSync("package-lock.json", "utf8"), "package-lock.json");
for (const [name, version, childName, childRange] of expectedChain) {
  const locked = packageLock.packages?.[`node_modules/${name}`];
  if (!locked || locked.version !== version || locked.dev !== true) {
    fail(`${name}@${version} is not locked exclusively as a development dependency.`);
  }
  if (childName && locked.dependencies?.[childName] !== childRange) {
    fail(`${name}@${version} no longer introduces the expected ${childName} range.`);
  }
}

console.warn(
  `Controlled exception accepted: ${advisory} / ${cve} in braces@3.0.3 (development-only).`,
);
console.warn("Production dependencies are clean and no other vulnerability was accepted.");
