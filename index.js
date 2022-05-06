const fs = require("fs");
const util = require("util");
const exec = util.promisify(require("child_process").exec);

const cheerio = require("cheerio");
const fetch = require("node-fetch");
const parseLinkHeader = require("parse-link-header");
const yargs = require("yargs");

const { BUILDKITE_API_TOKEN } = process.env;
if (!BUILDKITE_API_TOKEN) {
  throw new Error("Missing required env var BUILDKITE_API_TOKEN, see README");
}

const MAX_ARTIFACT_SIZE = 1024 * 1024 * 4; // Arbitrary 4Mb max size on artifacts

/** @typedef {{job_id: string, filename: string, download_url: string}} Artifact */

/**
 * Parse a job URL like https://buildkite.com/my-org/my-pipeline/builds/430653
 * Converts it to {orgSlug: "my-org", pipelineSlug: "my-pipeline", buildNumber: "430653"}
 * @param {string} jobUrl
 * @returns {{orgSlug: string, pipelineSlug: string, buildNumber: string}}
 */
function parseJobUrl(jobUrl) {
  const url = new URL(jobUrl);
  const match = url.pathname.match(
    /\/(?<orgSlug>.+)\/(?<pipelineSlug>.+)\/builds\/(?<buildNumber>\d+)/
  );
  return match.groups;
}

/**
 * Fetch a list of artifacts for a given job
 * Focuses only on junit.xml artifacts
 * @param {string} jobUrl
 * @returns {Promise<Artifact[]>}
 */
async function fetchListOfArtifacts(jobUrl) {
  const { orgSlug, pipelineSlug, buildNumber } = parseJobUrl(jobUrl);
  const results = [];
  let url = `https://api.buildkite.com//v2/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/artifacts?per_page=100`;

  do {
    let pageResponse = await fetch(url, { headers: { Authorization: `Bearer ${BUILDKITE_API_TOKEN}` } });
    let pageResults = await pageResponse.json();

    results.push(...pageResults);
    url = parseLinkHeader(pageResponse.headers.get("Link"))?.next?.url;
  } while (url);

  return results.filter((artifact) => artifact.filename === "junit.xml");
}

/**
 * Finds the "storage URL" of an artifact, which is the google cloud resource it can be downloaded from
 * @param {Artifact} artifact
 * @returns {Promise<string>}
 */
async function fetchStorageUrl(artifact) {
  const resp = await fetch(artifact.download_url, {
    redirect: "manual", // Don't follow the redirect, results in a Google Cloud login page
    headers: { Authorization: `Bearer ${BUILDKITE_API_TOKEN}` },
  });
  const data = await resp.json();
  return data["url"];
}

/**
 * Fetch content from a storage URL
 * @param {Artifact} artifact
 * @returns {Promise<string>}
 */
async function fetchContent(storageUrl) {
  const gsIdentifier = new URL(storageUrl).pathname.slice(1);
  try {
    const { stdout } = await exec(`gsutil cat gs://${gsIdentifier}`, {
      maxBuffer: MAX_ARTIFACT_SIZE,
    });
    return stdout;
  } catch (e) {
    process.stderr.write(
      "[ERROR] Failed to run the `gsutil` command, you may need to install it or setup permissions\n"
    );
    throw e;
  }
}

/**
 * Find a list of test names from a Junit document
 * @param {string} junit
 * @param {boolean} failuresOnly
 * @returns {string[]}
 */
function extractTestNames(junit, failuresOnly) {
  const $ = cheerio.load(junit);
  const query = failuresOnly
    ? "testsuites > testsuite > testcase:has(failure)"
    : "testsuites > testsuite > testcase";
  return $(query)
    .toArray()
    .map((node) => node.attribs.classname);
}

/**
 * Use a JSON file as a cache, return the content of the cache if present, or fn() if not
 * @template {Function} T
 * @param {string} cacheKey
 * @param {T} fn
 * @returns {ReturnType<T>}
 */
async function withJsonCache(cacheFile, fn) {
  try {
    return JSON.parse(await fs.promises.readFile(cacheFile));
  } catch (e) {
    const result = await fn();
    fs.promises.writeFile(cacheFile, JSON.stringify(result));
    return result;
  }
}

/**
 * Fetch all artifacts from a given job URL, leveraging a cache to avoid re-downloading
 * @param {string} jobUrl
 * @param {boolean} cache
 * @returns {Promise<string[]>}
 */
async function fetchArtifactContents(jobUrl, cache) {
  const cacheKey = jobUrl.replace(/[/:]/g, "_");
  const cacheFile = `/tmp/${cacheKey}`;

  const fetcher = async () => {
    const artifacts = await fetchListOfArtifacts(jobUrl);
    return Promise.all(
      artifacts.map(async (artifact) => {
        const storageUrl = await fetchStorageUrl(artifact);
        const content = await fetchContent(storageUrl);
        return content;
      })
    );
  }

  if (cache) {
    return withJsonCache(cacheFile, fetcher);
  } else {
    return fetcher();
  }
}

yargs
  .scriptName("buildkite-dl")
  .command(
    "$0 <jobUrl>",
    "list tests from a CI job",
    {
      failuresOnly: {
        boolean: true,
        default: false,
        desc: "Only list failed tests",
      },
      sort: {
        boolean: true,
        default: true,
        desc: "Sort the results alphabetically",
      },
      cache: {
        boolean: true,
        default: true,
        desc: "Read artifacts from local cache if present",
      }
    },
    async ({ jobUrl, failuresOnly, sort, cache }) => {
      const artifactContents = await fetchArtifactContents(jobUrl, cache);
      const testNames = artifactContents.flatMap((junit) =>
        extractTestNames(junit, failuresOnly)
      );

      if (sort) {
          testNames.sort();
      }

      testNames.forEach((name) => console.log(name));
    }
  )
  .help().argv;
