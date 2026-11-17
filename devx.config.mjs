export default {
  projectName: 'pokepaper',
  editor: {
    command: 'code',
    args: ['--profile', 'Ionic'],
  },
  branchPrefix: 'feat/',
  baseBranch: 'main',
  worktree: {
    adapterModule: 'scripts/worktree-dev.mjs',
  },
  pr: {
    baseRef: 'origin/main',
    prepOutputFile: 'prompts/pr-prep-prompt.md',
    feedbackOutputFile: 'prompts/pr-feedback-prompt.md',
    excludedDiffPaths: [':(glob,exclude)**/package-lock.json', ':(glob,exclude)**/dist/**'],
    ciWorkflowName: 'CI PR Checks',
    verifyCommands: ['npm run format:check', 'npm run test:scripts'],
  },
};
