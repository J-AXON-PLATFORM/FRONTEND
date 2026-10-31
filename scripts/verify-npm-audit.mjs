import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BRACES_ADVISORY = "GHSA-vfj7-8cjw-p6xm";
const BRACES_CVE = "CVE-2026-93687";
const MINIMATCH_ADVISORY = "GHSA-g3hv-75wg-m249";
const MINIMATCH_CVE = "CVE-2026-118764";
const MINIMATCH_FIXED_VERSION = "11.0.1";

const bracesVulnerabilities = new Map([
  ["braces", { direct: false, via: BRACES_ADVISORY }],
  ["micromatch", { direct: false, via: "braces" }],
  ["fast-glob", { direct: false, via: "micromatch" }],
  ["@next/eslint-plugin-next", { direct: false, via: "fast-glob" }],
  ["eslint-config-next", { direct: true, via: "@next/eslint-plugin-next" }],
]);
const bracesChain = [
  ["eslint-config-next", "16.4.2", "@next/eslint-plugin-next", "16.4.2"],
  ["@next/eslint-plugin-next", "16.4.2", "fast-glob", "3.3.1"],
  ["fast-glob", "3.3.1", "micromatch", "^4.0.4"],
  ["micromatch", "4.0.8", "braces", "^3.0.3"],
  ["braces", "3.0.3", null, null],
];

const minimatchLockEntries = new Map([
  ["node_modules/minimatch", "10.2.6"],
  ["node_modules/@eslint/config-array/node_modules/minimatch", "3.1.5"],
  ["node_modules/@eslint/eslintrc/node_modules/minimatch", "3.1.5"],
  ["node_modules/eslint-config-next/node_modules/minimatch", "3.1.5"],
  ["node_modules/eslint/node_modules/minimatch", "3.1.5"],
]);

const minimatchGraph = {
  "@eslint-community/eslint-utils": {
    direct: false,
    via: ["eslint"],
    nodes: [
      "node_modules/@eslint-community/eslint-utils",
      "node_modules/@next/eslint-plugin-next/node_modules/@eslint-community/eslint-utils",
    ],
  },
  "@eslint/config-array": {
    direct: false,
    via: ["minimatch"],
    nodes: ["node_modules/@eslint/config-array"],
  },
  "@eslint/eslintrc": {
    direct: false,
    via: ["minimatch"],
    nodes: ["node_modules/@eslint/eslintrc"],
  },
  "@next/eslint-plugin-next": {
    direct: false,
    via: ["@eslint-community/eslint-utils"],
    nodes: ["node_modules/@next/eslint-plugin-next"],
  },
  "@typescript-eslint/eslint-plugin": {
    direct: false,
    via: [
      "@typescript-eslint/parser",
      "@typescript-eslint/type-utils",
      "@typescript-eslint/utils",
      "eslint",
    ],
    nodes: ["node_modules/@typescript-eslint/eslint-plugin"],
  },
  "@typescript-eslint/parser": {
    direct: false,
    via: ["@typescript-eslint/typescript-estree", "eslint"],
    nodes: ["node_modules/@typescript-eslint/parser"],
  },
  "@typescript-eslint/type-utils": {
    direct: false,
    via: ["@typescript-eslint/typescript-estree", "@typescript-eslint/utils", "eslint"],
    nodes: ["node_modules/@typescript-eslint/type-utils"],
  },
  "@typescript-eslint/typescript-estree": {
    direct: false,
    via: ["minimatch"],
    nodes: ["node_modules/@typescript-eslint/typescript-estree"],
  },
  "@typescript-eslint/utils": {
    direct: false,
    via: ["@eslint-community/eslint-utils", "@typescript-eslint/typescript-estree", "eslint"],
    nodes: ["node_modules/@typescript-eslint/utils"],
  },
  eslint: {
    direct: true,
    via: ["@eslint-community/eslint-utils", "@eslint/config-array", "@eslint/eslintrc", "minimatch"],
    nodes: ["node_modules/eslint"],
  },
  "eslint-config-next": {
    direct: true,
    via: [
      "@next/eslint-plugin-next",
      "eslint",
      "eslint-plugin-import",
      "eslint-plugin-jsx-a11y",
      "eslint-plugin-react",
      "typescript-eslint",
    ],
    nodes: ["node_modules/eslint-config-next"],
  },
  "eslint-plugin-import": {
    direct: false,
    via: ["minimatch"],
    nodes: ["node_modules/eslint-config-next/node_modules/eslint-plugin-import"],
  },
  "eslint-plugin-jsx-a11y": {
    direct: false,
    via: ["minimatch"],
    nodes: ["node_modules/eslint-config-next/node_modules/eslint-plugin-jsx-a11y"],
  },
  "eslint-plugin-react": {
    direct: false,
    via: ["minimatch"],
    nodes: ["node_modules/eslint-config-next/node_modules/eslint-plugin-react"],
  },
  minimatch: {
    direct: false,
    via: [MINIMATCH_ADVISORY],
    range: "<11.0.1",
    nodes: [...minimatchLockEntries.keys()].slice(1).concat("node_modules/minimatch"),
  },
  "typescript-eslint": {
    direct: false,
    via: [
      "@typescript-eslint/eslint-plugin",
      "@typescript-eslint/parser",
      "@typescript-eslint/typescript-estree",
      "@typescript-eslint/utils",
      "eslint",
    ],
    nodes: ["node_modules/typescript-eslint"],
  },
};

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

function sameValues(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function sameStringSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    sameValues([...actual].sort(), [...expected].sort())
  );
}

function advisoryId(entry) {
  return typeof entry === "string" ? entry : entry?.url?.split("/").at(-1);
}

function containsDependency(node, name) {
  if (!node || typeof node !== "object") return false;
  if (Object.hasOwn(node.dependencies ?? {}, name)) return true;
  return Object.values(node.dependencies ?? {}).some((dependency) =>
    containsDependency(dependency, name),
  );
}

function validateDirectDependencies(packageJson) {
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  for (const name of ["braces", "minimatch"]) {
    if (sections.some((section) => Object.hasOwn(packageJson[section] ?? {}, name))) {
      return `${name} must not be a direct dependency.`;
    }
  }
  return null;
}

function validateProductionTree(tree, status) {
  if (![0, 1].includes(status) || tree.error || tree.problems) {
    return "the production dependency tree could not be verified.";
  }
  for (const name of ["braces", "minimatch"]) {
    if (containsDependency(tree, name)) {
      return `${name} is present in the production dependency tree.`;
    }
  }
  return null;
}

function validateLock(packageLock, profile) {
  if (profile === "minimatch" || profile === "combined") {
    const actualMinimatchPaths = Object.keys(packageLock.packages ?? {}).filter(
      (path) => path === "node_modules/minimatch" || path.endsWith("/node_modules/minimatch"),
    );
    if (!sameValues(actualMinimatchPaths.sort(), [...minimatchLockEntries.keys()].sort())) {
      return "minimatch lock paths changed.";
    }
    for (const [path, version] of minimatchLockEntries) {
      const locked = packageLock.packages[path];
      if (!locked || locked.version !== version || locked.dev !== true) {
        return `${path} must be minimatch@${version} and development-only.`;
      }
    }
  }
  if (profile === "braces" || profile === "combined") {
    for (const [name, version, childName, childRange] of bracesChain) {
      const locked = packageLock.packages?.[`node_modules/${name}`];
      if (!locked || locked.version !== version || locked.dev !== true) {
        return `${name}@${version} is not locked exclusively as a development dependency.`;
      }
      if (childName && locked.dependencies?.[childName] !== childRange) {
        return `${name}@${version} no longer introduces the expected ${childName} range.`;
      }
    }
  }
  return null;
}

function validateMinimatchAdvisory(vulnerability) {
  const detail = vulnerability?.via?.[0];
  const expected = {
    source: 1244012,
    name: "minimatch",
    dependency: "minimatch",
    title: "minimatch has potential denial of service via globparts amplification",
    url: `https://github.com/advisories/${MINIMATCH_ADVISORY}`,
    severity: "moderate",
    cwe: ["CWE-405"],
    cvss: { score: 0, vectorString: null },
    range: "<11.0.1",
  };
  return typeof detail === "object" && sameValues(detail, expected)
    ? null
    : `the ${MINIMATCH_ADVISORY} advisory metadata changed.`;
}

function validateBracesGraph(vulnerabilities, combined) {
  for (const [name, expected] of bracesVulnerabilities) {
    const vulnerability = vulnerabilities[name];
    const expectedSeverity = "high";
    const expectedVia =
      combined && name === "@next/eslint-plugin-next"
        ? ["@eslint-community/eslint-utils", "fast-glob"]
        : combined && name === "eslint-config-next"
          ? minimatchGraph["eslint-config-next"].via
        : [expected.via];
    if (
      !vulnerability ||
      vulnerability.severity !== expectedSeverity ||
      vulnerability.isDirect !== expected.direct ||
      !sameStringSet(vulnerability.via.map(advisoryId), expectedVia)
    ) {
      return `${name} changed in the braces exception graph.`;
    }
  }
  const detail = vulnerabilities.braces.via[0];
  if (
    typeof detail !== "object" ||
    detail.name !== "braces" ||
    detail.severity !== "high" ||
    detail.url !== `https://github.com/advisories/${BRACES_ADVISORY}` ||
    detail.range !== "<=3.0.3"
  ) {
    return `the ${BRACES_ADVISORY} advisory metadata changed.`;
  }
  return null;
}

function validateMinimatchGraph(vulnerabilities, combined) {
  for (const [name, expected] of Object.entries(minimatchGraph)) {
    const vulnerability = vulnerabilities[name];
    const expectedVia =
      combined && name === "@next/eslint-plugin-next"
        ? ["@eslint-community/eslint-utils", "fast-glob"]
        : expected.via;
    const expectedSeverity =
      combined && ["@next/eslint-plugin-next", "eslint-config-next"].includes(name)
        ? "high"
        : "moderate";
    if (
      !vulnerability ||
      vulnerability.name !== name ||
      vulnerability.severity !== expectedSeverity ||
      vulnerability.isDirect !== expected.direct ||
      !sameStringSet(vulnerability.via.map(advisoryId), expectedVia) ||
      (name === "minimatch" && vulnerability.range !== expected.range) ||
      !sameStringSet(vulnerability.nodes, expected.nodes)
    ) {
      return `${name} changed in the minimatch exception graph.`;
    }
  }
  return validateMinimatchAdvisory(vulnerabilities.minimatch);
}

function validateAudit(audit, status) {
  if (audit.error || audit.auditReportVersion !== 2 || !audit.vulnerabilities || !audit.metadata) {
    return { error: "npm audit returned an error or an unsupported report structure." };
  }
  const names = Object.keys(audit.vulnerabilities);
  if (names.length === 0) {
    if (status !== 0 || audit.metadata.vulnerabilities?.total !== 0) {
      return { error: "npm audit reported inconsistent clean results." };
    }
    return { profile: "clean" };
  }
  if (status === 0) return { error: "npm audit reported vulnerabilities with a successful exit code." };
  if (status !== 1) return { error: `npm audit failed with unexpected exit code ${status}.` };

  const hasBraces = names.includes("braces");
  const hasMinimatch = names.includes("minimatch");
  if (!hasBraces && !hasMinimatch) {
    return { error: `unexpected vulnerable packages: ${names.join(", ")}.` };
  }
  const expectedNames = new Set([
    ...(hasBraces ? bracesVulnerabilities.keys() : []),
    ...(hasMinimatch ? Object.keys(minimatchGraph) : []),
  ]);
  if (!sameValues(names.sort(), [...expectedNames].sort())) {
    return { error: `unexpected vulnerable packages: ${names.join(", ")}.` };
  }

  const combined = hasBraces && hasMinimatch;
  const graphError =
    (hasMinimatch && validateMinimatchGraph(audit.vulnerabilities, combined)) ||
    (hasBraces && validateBracesGraph(audit.vulnerabilities, combined));
  if (graphError) return { error: graphError };

  const counts = audit.metadata.vulnerabilities;
  const expectedCounts = combined
    ? { info: 0, low: 0, moderate: 14, high: 5, critical: 0, total: 19 }
    : hasMinimatch
      ? { info: 0, low: 0, moderate: 16, high: 0, critical: 0, total: 16 }
      : { info: 0, low: 0, moderate: 0, high: 5, critical: 0, total: 5 };
  if (!sameValues(counts, expectedCounts)) {
    return { error: "npm audit contains vulnerabilities outside the approved exceptions." };
  }
  return { profile: combined ? "combined" : hasMinimatch ? "minimatch" : "braces" };
}

function validateAll({ packageJson, packageLock, productionTree, productionStatus, audit, auditStatus }) {
  const directError = validateDirectDependencies(packageJson);
  if (directError) return { error: directError };
  const productionError = validateProductionTree(productionTree, productionStatus);
  if (productionError) return { error: productionError };
  const auditResult = validateAudit(audit, auditStatus);
  if (auditResult.error) return auditResult;
  const lockError = validateLock(packageLock, auditResult.profile);
  return lockError ? { error: lockError } : auditResult;
}

function clone(value) {
  return structuredClone(value);
}

function makeSelfTestFixture(profile = "minimatch") {
  const packageLock = { packages: {} };
  if (profile === "minimatch" || profile === "combined") {
    for (const [path, version] of minimatchLockEntries) {
      packageLock.packages[path] = { version, dev: true };
    }
  }
  for (const [name, version, childName, childRange] of bracesChain) {
    packageLock.packages[`node_modules/${name}`] = {
      ...(packageLock.packages[`node_modules/${name}`] ?? {}),
      version,
      dev: true,
      ...(childName ? { dependencies: { [childName]: childRange } } : {}),
    };
  }

  const vulnerabilities = {};
  if (profile === "minimatch" || profile === "combined") {
    for (const [name, expected] of Object.entries(minimatchGraph)) {
      vulnerabilities[name] = {
        name,
        severity:
          profile === "combined" && ["@next/eslint-plugin-next", "eslint-config-next"].includes(name)
            ? "high"
            : "moderate",
        isDirect: expected.direct,
        via: [...expected.via],
        effects: [],
        ...(name === "minimatch" ? { range: expected.range } : {}),
        nodes: [...expected.nodes],
        fixAvailable: true,
      };
    }
    vulnerabilities.minimatch.via = [
      {
        source: 1244012,
        name: "minimatch",
        dependency: "minimatch",
        title: "minimatch has potential denial of service via globparts amplification",
        url: `https://github.com/advisories/${MINIMATCH_ADVISORY}`,
        severity: "moderate",
        cwe: ["CWE-405"],
        cvss: { score: 0, vectorString: null },
        range: "<11.0.1",
      },
    ];
  }
  if (profile === "braces" || profile === "combined") {
    for (const [name, expected] of bracesVulnerabilities) {
      vulnerabilities[name] ??= {
        name,
        severity: "high",
        isDirect: expected.direct,
        via: [expected.via],
        effects: [],
        range: "*",
        nodes: [`node_modules/${name}`],
        fixAvailable: true,
      };
      vulnerabilities[name].severity = "high";
    }
    vulnerabilities.braces.via = [
      {
        name: "braces",
        url: `https://github.com/advisories/${BRACES_ADVISORY}`,
        severity: "high",
        range: "<=3.0.3",
      },
    ];
    if (profile === "combined") {
      vulnerabilities["@next/eslint-plugin-next"].via = [
        "@eslint-community/eslint-utils",
        "fast-glob",
      ];
    }
  }
  const counts =
    profile === "clean"
      ? { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }
      : profile === "combined"
      ? { info: 0, low: 0, moderate: 14, high: 5, critical: 0, total: 19 }
      : profile === "braces"
        ? { info: 0, low: 0, moderate: 0, high: 5, critical: 0, total: 5 }
        : { info: 0, low: 0, moderate: 16, high: 0, critical: 0, total: 16 };
  return {
    packageJson: { dependencies: {}, devDependencies: {} },
    packageLock,
    productionTree: { dependencies: {} },
    productionStatus: 1,
    audit: { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } },
    auditStatus: profile === "clean" ? 0 : 1,
  };
}

function runSelfTest() {
  const positiveCases = ["clean", "minimatch", "braces", "combined"];
  for (const profile of positiveCases) {
    const result = validateAll(makeSelfTestFixture(profile));
    if (result.error || result.profile !== profile) {
      fail(`self-test positive case ${profile} failed: ${result.error ?? result.profile}`);
    }
  }
  const reorderedFixture = makeSelfTestFixture();
  reorderedFixture.audit.vulnerabilities["@typescript-eslint/type-utils"].via.reverse();
  reorderedFixture.audit.vulnerabilities.minimatch.nodes.reverse();
  if (validateAll(reorderedFixture).error) {
    fail("self-test positive case reordered audit sets failed.");
  }
  const derivedRangeFixture = makeSelfTestFixture();
  derivedRangeFixture.audit.vulnerabilities["@typescript-eslint/type-utils"].range = "unstable-derived-range";
  if (validateAll(derivedRangeFixture).error) {
    fail("self-test positive case variable derived range failed.");
  }

  const negativeCases = [
    ["another advisory", (fixture) => {
      fixture.audit.vulnerabilities.minimatch.via[0].url = "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx";
    }],
    ["severity", (fixture) => {
      fixture.audit.vulnerabilities.minimatch.severity = "high";
    }],
    ["root advisory range", (fixture) => {
      fixture.audit.vulnerabilities.minimatch.range = "<12.0.0";
    }],
    ["lock version", (fixture) => {
      fixture.packageLock.packages["node_modules/minimatch"].version = "11.0.1";
    }],
    ["lock path", (fixture) => {
      fixture.packageLock.packages["node_modules/extra/node_modules/minimatch"] = { version: "3.1.5", dev: true };
    }],
    ["additional transitive path", (fixture) => {
      fixture.audit.vulnerabilities["@typescript-eslint/type-utils"].via.push("unexpected");
    }],
    ["production presence", (fixture) => {
      fixture.productionTree.dependencies.minimatch = { version: "10.2.6" };
    }],
    ["direct dependency", (fixture) => {
      fixture.packageJson.devDependencies.minimatch = "10.2.6";
    }],
    ["extra vulnerable package", (fixture) => {
      fixture.audit.vulnerabilities.unexpected = { name: "unexpected" };
      fixture.audit.metadata.vulnerabilities.total += 1;
    }],
  ];
  for (const [name, mutate] of negativeCases) {
    const fixture = clone(makeSelfTestFixture());
    mutate(fixture);
    if (!validateAll(fixture).error) fail(`self-test negative case ${name} was accepted.`);
  }
  console.log("Dependency audit verifier self-test passed (6 positive and 9 negative cases).");
}

if (process.argv.slice(2).includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

const packageJson = parseJson(readFileSync("package.json", "utf8"), "package.json");
const packageLock = parseJson(readFileSync("package-lock.json", "utf8"), "package-lock.json");
const productionTreeResult = runNpm(["ls", "braces", "minimatch", "--omit=dev", "--all", "--json"]);
const productionTree = parseJson(productionTreeResult.stdout, "npm production tree");
const auditResult = runNpm(["audit", "--json"]);
const audit = parseJson(auditResult.stdout, "npm audit");
const result = validateAll({
  packageJson,
  packageLock,
  productionTree,
  productionStatus: productionTreeResult.status,
  audit,
  auditStatus: auditResult.status,
});
if (result.error) fail(result.error);

if (result.profile === "clean") {
  console.log("Dependency audit is clean. Production dependencies are clean; no temporary exception is required.");
} else {
  if (result.profile === "minimatch" || result.profile === "combined") {
    console.warn(
      `Temporary development-only exception accepted: ${MINIMATCH_ADVISORY} / ${MINIMATCH_CVE} in minimatch (<11.0.1; official fixed version ${MINIMATCH_FIXED_VERSION}).`,
    );
  }
  if (result.profile === "braces" || result.profile === "combined") {
    console.warn(
      `Temporary development-only exception accepted: ${BRACES_ADVISORY} / ${BRACES_CVE} in braces@3.0.3.`,
    );
  }
  console.warn("Production dependencies are clean; no production vulnerability was accepted.");
}
