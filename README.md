# buildkite-dl

Download junit.xml artifacts from a Buildkite job and list the tests found

## Installation

You'll need the `gsutil` command line utility and need to be authenticated with the GCS organization where your Buildkite is configured to host artifacts.

You'll also need to create a [Buildkite API token](https://buildkite.com/user/api-access-tokens) and set it in a BUILDKITE_API_TOKEN environment variable. The token should have scopes for `read_build`, `read_pipelines`, and `read_artifacts`, as well as having organization access for any organizations that you want to use it on.

Your build must capture test results as `junit.xml` test artifacts, these will provide the details to this tool of which files failed. Many test runners can be configured to emit such a file, here are a few examples:
- Jest: https://www.npmjs.com/package/jest-junit
- Minitest: https://github.com/minitest-reporters/minitest-reporters

## Usage

```
buildkite-dl <jobUrl>

list tests from a CI job

Options:
  --version       Show version number                                  [boolean]
  --help          Show help                                            [boolean]
  --failuresOnly  Only list failed tests              [boolean] [default: false]
  --sort          Sort the results alphabetically      [boolean] [default: true]
  --cache         Read artifacts from local cache if present
                                                       [boolean] [default: true]
  --verbose       Enable logging                      [boolean] [default: false]
```


## Examples

``` sh
export BUILDKITE_API_TOKEN=<your buildkite api token>

# List all junit tests from https://buildkite.com/my-org/my-pipeline/builds/12345
npx buildkite-dl https://buildkite.com/my-org/my-pipeline/builds/12345

# List only the failed tests
npx buildkite-dl --failures-only https://buildkite.com/my-org/my-pipeline/builds/12345

# Full list of options
npx buildkite-dl --help
```
