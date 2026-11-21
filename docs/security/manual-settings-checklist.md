# Manual repository and organization settings checklist

These settings cannot be committed as files. They are UI/API actions a
repository or organization admin must complete. Do not treat this checklist as
already applied.

## Organization

- [ ] Require two-factor authentication for all organization members
      (Organization settings → Authentication security → **Require two-factor
      authentication**).
- [ ] Set **Require approval for first-time contributors** to enabled
      (Organization settings → Actions → General → Fork pull request workflows;
      also review the repository-level equivalent). This stops a first-time
      contributor's workflow changes from running without approval.
- [ ] Set the default `GITHUB_TOKEN` workflow permissions to **read-only**
      (Organization settings → Actions → General → Workflow permissions, and
      repository Settings → Actions → General → Workflow permissions).
- [ ] Disallow GitHub Actions from creating or approving pull requests
      (Organization settings → Actions → General → "Allow GitHub Actions to
      create and approve pull requests" **off**).
- [ ] Restrict who can create and publish actions, if the organization publishes
      reusable actions.
- [ ] Confirm which members can change repository visibility and rulesets.

## Repository

- [ ] Apply the branch ruleset: run
      `scripts/security/apply-ruleset.sh --dry-run`, confirm the payload and
      status-check names, then run it without `--dry-run`.
- [ ] Confirm the ruleset has **no bypass actors** and applies to the default
      branch.
- [ ] Enable **secret scanning** and **push protection** (Settings → Code
      security → Code security and analysis). The API calls are commented in
      `scripts/security/apply-ruleset.sh`.
- [ ] Enable **Dependabot security updates** (Settings → Code security).
- [ ] Enable **private vulnerability reporting** (Settings → Code security).
- [ ] Confirm `@aigbagbobila` has access and is the code owner in
      `.github/CODEOWNERS`; "Require review from Code Owners" only works when
      the reviewer has write access.
- [ ] Review the environment protection rules for any deployment environment
      (Settings → Environments): require reviewers for production and restrict
      deployment branches to `main`.

## Hosting provider: preview deploys and fork PRs

Confirm the preview-deployment behavior with the provider's current settings.

- [ ] **Vercel:** determine whether Git integration or the `deploy.yml`
      workflow creates previews. In the Vercel project settings, confirm
      preview deployments are only created for branches in this repository, and
      verify under Project → Settings → Environment Variables that secrets are
      scoped to **Production** (and, if needed, **Preview**) and are **not**
      available to forked pull requests. Prefer not granting Vercel access to
      fork PRs at all. The GitHub workflow in `.github/workflows/deploy.yml`
      uses `pull_request` nowhere, so forked PRs do not receive
      `VERCEL_TOKEN` through it.
- [ ] **Netlify:** in Site configuration → Build & deploy → Deploy contexts,
      disable **Deploy previews** for pull requests from forks, or confirm that
      environment variables are not exposed to fork builds. Netlify's
      "Deploy previews" settings and environment-variable scoping are the
      relevant controls.
- [ ] If previews are required for fork PRs, use a separate, least-privilege
      preview environment with no production secrets, and require maintainer
      approval before a preview build runs (`pull_request_target` is **not** an
      acceptable substitute: it runs with the base repository's secrets and
      write token).
- [ ] Verify with a test fork PR that no environment variables or deployment
      tokens are available to the build, and that no preview deploy is created
      from untrusted code with production credentials.
