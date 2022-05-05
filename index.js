const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const cheerio = require('cheerio');
const fetch = require('node-fetch');

const {BUILDKITE_API_TOKEN} = process.env;
if (!BUILDKITE_API_TOKEN) {
    throw new Error("Missing required env var BUILDKITE_API_TOKEN");
}

function parseJobUrl(jobUrl) {
    const url = new URL(jobUrl);
    const match = url.pathname.match(/\/(?<orgSlug>.+)\/(?<pipelineSlug>.+)\/builds\/(?<buildNumber>\d+)/);
    return match.groups;
}

/** @returns {Promise<{job_id: string, filename: string, download_url: string}[]>} */
async function fetchListOfArtifacts(jobUrl) {
    const {orgSlug, pipelineSlug, buildNumber} = parseJobUrl(jobUrl);
    const resp = await fetch(
        `https://api.buildkite.com//v2/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/artifacts?per_page=100`,
        {headers: {'Authorization': `Bearer ${BUILDKITE_API_TOKEN}`}
    });
    return await resp.json();
}

async function fetchArtifactContent(artifact) {
    process.stderr.write(`Fetching ${artifact.download_url}...\n`);
    const resp = await fetch(artifact.download_url, {
        redirect: 'manual',
        headers: {'Authorization': `Bearer ${BUILDKITE_API_TOKEN}`}
    });
    const {url: storageUrl} = await resp.json();
    const gsIdentifier = new URL(storageUrl).pathname.slice(1);
    const {stdout} = await exec(`gsutil cat gs://${gsIdentifier}`, {maxBuffer: 1024 * 1024 * 5});
    return stdout;
}

function extractTestNames(junit) {
    const $ = cheerio.load(junit);
    return $('testsuites > testsuite > testcase')
        .toArray()
        .map(node => node.attribs.classname)
}

async function loadAllJunits(jobUrl) {
    const cacheKey = jobUrl.replace(/[/:]/g, '_');
    const cacheFile = `/tmp/${cacheKey}`;

    try {
        return JSON.parse(await fs.promises.readFile(cacheFile));
    } catch {
        const artifacts = await fetchListOfArtifacts(jobUrl);
        const artifactContents = await Promise.all(
            artifacts
                .filter((artifact) => artifact.filename === 'junit.xml')
                .map((artifact) => fetchArtifactContent(artifact))
        );

        await fs.promises.writeFile(cacheFile, JSON.stringify(artifactContents));

        return artifactContents;
    }
}

async function main() {
    const jobUrl = process.argv[2];
    if (!jobUrl) {
        throw new Error("usage: node index.js BUILDKITE_JOB_URL")
    }

    const junits = await loadAllJunits(jobUrl);
    const testNames = junits.flatMap(junit => extractTestNames(junit));
    
    testNames
        .sort()
        .forEach(name => console.log(name));
}

main();