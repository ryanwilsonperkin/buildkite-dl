# buildkite-dl

Download junit.xml artifacts from a Buildkite job and list the tests found

## Installation

Works using npx for fetching and then running the command, rather than
installing it.

You'll need the `gsutil` command line utility and need to be authenticated with
the GCS organization where your Buildkite is configured to host artifacts.

## Usage

``` sh
# List all junit tests from https://buildkite.com/my-org/my-pipeline/builds/12345
npx buildkite-dl https://buildkite.com/my-org/my-pipeline/builds/12345

# List only the failed tests
npx buildkite-dl --failures-only https://buildkite.com/my-org/my-pipeline/builds/12345

# Full list of options
npx buildkite-dl --help
```
