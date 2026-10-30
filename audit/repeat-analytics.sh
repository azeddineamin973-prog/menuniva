#!/bin/zsh
# Phase D: run analytics-subscription.spec.ts N times as separate Playwright invocations
# (fresh build + fresh server + fresh seed each time), retries disabled, every log kept.
n=${1:-10}
for i in $(seq 1 $n); do
  audit/run.sh "d-analytics-iso-$i" npx playwright test tests/e2e/analytics-subscription.spec.ts --retries=0 --reporter=list --output=audit/artifacts/d-analytics-iso-$i
done
