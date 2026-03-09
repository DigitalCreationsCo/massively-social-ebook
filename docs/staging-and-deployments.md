# Staging and Deployments

Core development is done in feature branches.

When you're ready for staging, be sure to merge staging from merge to get correct version. Run tests in staging.

When you're ready for prod, merge staging to main. Run tests in main.

Run npm run release:patch|minor|major to release to ci.
