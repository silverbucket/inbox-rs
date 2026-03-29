#!/bin/bash

if [ "$#" -ne 1 ]; then
    echo "Error: Version is required." >&2
    echo "Usage: $0 v<version>" >&2
    exit 1
fi

# Check if the argument starts with 'v'
if [[ "$1" != v* ]]; then
    # If it doesn't start with 'v', prepend it
    set -- "v$1"
fi

version=$1

git checkout master &&
git pull &&
git co -b release/${version} &&
npm i &&
npm run build &&
npm run build --workspace=packages/web &&
git add . &&
git commit -m "release ${version}" . &&
git tag ${version} &&
git push &&
git push --tags &&
git subtree push --prefix=packages/web/dist 5apps master

echo "Version ${version} deploy, merge release PR on github page"

