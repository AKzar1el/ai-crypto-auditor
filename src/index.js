import core from '@actions/core';
import github from '@actions/github';

async function auditCode(filename, content, apiKey, model) {
  const prompt = `You are an expert Web3 smart contract security auditor.
Analyze the following code for security vulnerabilities (e.g., reentrancy, flash loan attacks, overflow/underflow, access control flaws), logic issues, performance bottlenecks, or gas optimization opportunities.

Format your response in professional Markdown. Use clear headings for vulnerabilities:
- **Severity Levels**: CRITICAL, HIGH, MEDIUM, LOW, INFO.
- **Problem**: Short description.
- **Line/Location**: Code snippet or line.
- **Recommendation**: How to fix it.

File to audit: ${filename}

Code:
\`\`\`
${content}
\`\`\`
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API returned ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  return result.candidates?.[0]?.content?.parts?.[0]?.text || "No auditing feedback generated.";
}

function shouldExclude(filename, patternsStr) {
  if (!patternsStr) return false;
  const patterns = patternsStr.split(',').map(p => p.trim()).filter(Boolean);
  return patterns.some(pattern => {
    // Simple glob matching
    const regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
    try {
      const regex = new RegExp(regexStr);
      return regex.test(filename) || filename.includes(pattern);
    } catch {
      return filename.includes(pattern);
    }
  });
}

async function run() {
  try {
    const githubToken = core.getInput('github-token');
    const geminiApiKey = core.getInput('gemini-api-key');
    const excludePaths = core.getInput('exclude-paths');
    const geminiModel = core.getInput('gemini-model') || 'gemini-1.5-pro';

    const octokit = github.getOctokit(githubToken);
    const context = github.context;

    if (!context.payload.pull_request) {
      core.info("This action only runs on pull request events.");
      return;
    }

    const prNumber = context.payload.pull_request.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    core.info(`Fetching files changed in PR #${prNumber}...`);
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber
    });

    const auditableExtensions = ['.sol', '.rs', '.go', '.ts', '.js', '.move', '.py'];
    
    for (const file of files) {
      const ext = file.filename.substring(file.filename.lastIndexOf('.'));
      if (!auditableExtensions.includes(ext) || file.status === 'removed') {
        continue;
      }

      if (shouldExclude(file.filename, excludePaths)) {
        core.info(`Skipping excluded file: ${file.filename}`);
        continue;
      }

      core.info(`Auditing ${file.filename} using model ${geminiModel}...`);

      // Fetch file content
      const { data: fileContentData } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: file.path,
        ref: context.payload.pull_request.head.sha
      });

      const content = Buffer.from(fileContentData.content, 'base64').toString('utf-8');

      try {
        const auditReport = await auditCode(file.filename, content, geminiApiKey, geminiModel);

        const commentBody = `### 🛡️ AI Crypto Auditor Report for \`${file.filename}\`
        
${auditReport}

*Audited automatically by [AI Crypto Auditor](https://github.com/${owner}/${repo}) using Gemini AI (${geminiModel}).*
`;

        // Post comment to PR
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: commentBody
        });

        core.info(`Audit report posted for ${file.filename}`);
      } catch (err) {
        core.error(`Failed to audit ${file.filename}: ${err.message}`);
      }
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

