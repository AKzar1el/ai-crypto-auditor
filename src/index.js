import core from '@actions/core';
import github from '@actions/github';

async function callLlm(prompt, provider, apiKey, model) {
  let url = "";
  let headers = { "Content-Type": "application/json" };
  let body = {};

  const cleanProvider = provider.toLowerCase().trim();

  if (cleanProvider === "gemini") {
    const targetModel = model || "gemini-1.5-pro";
    url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
    body = {
      contents: [{ parts: [{ text: prompt }] }]
    };
  } else if (cleanProvider === "anthropic") {
    const targetModel = model || "claude-3-5-sonnet-latest";
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: targetModel,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }]
    };
  } else {
    // OpenAI, DeepSeek, OpenRouter, Groq
    let baseUrl = "https://api.openai.com/v1";
    let targetModel = model;

    if (cleanProvider === "deepseek") {
      baseUrl = "https://api.deepseek.com/v1";
      targetModel = model || "deepseek-chat";
    } else if (cleanProvider === "openrouter") {
      baseUrl = "https://openrouter.ai/api/v1";
      targetModel = model || "meta-llama/llama-3.1-70b-instruct";
    } else if (cleanProvider === "groq") {
      baseUrl = "https://api.groq.com/openai/v1";
      targetModel = model || "llama3-70b-8192";
    } else {
      // Default OpenAI
      targetModel = model || "gpt-4o";
    }

    url = `${baseUrl}/chat/completions`;
    headers["Authorization"] = `Bearer ${apiKey}`;
    body = {
      model: targetModel,
      messages: [{ role: "user", content: prompt }]
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`${provider} API returned ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();

  if (cleanProvider === "gemini") {
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response content.";
  } else if (cleanProvider === "anthropic") {
    return data.content?.[0]?.text || "No response content.";
  } else {
    return data.choices?.[0]?.message?.content || "No response content.";
  }
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
    const apiProvider = core.getInput('api-provider') || 'gemini';
    
    // Support backwards compatibility for gemini-api-key
    const apiKey = core.getInput('api-key') || core.getInput('gemini-api-key');
    if (!apiKey) {
      throw new Error("Missing API Key input.");
    }

    const excludePaths = core.getInput('exclude-paths');
    
    // Support backwards compatibility for gemini-model
    const model = core.getInput('model') || core.getInput('gemini-model');

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

      core.info(`Auditing ${file.filename} using ${apiProvider}...`);

      // Fetch file content
      const { data: fileContentData } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: file.path,
        ref: context.payload.pull_request.head.sha
      });

      const content = Buffer.from(fileContentData.content, 'base64').toString('utf-8');

      const prompt = `You are an expert Web3 smart contract security auditor.
Analyze the following code for security vulnerabilities (e.g., reentrancy, flash loan attacks, overflow/underflow, access control flaws), logic issues, performance bottlenecks, or gas optimization opportunities.

Format your response in professional Markdown. Use clear headings for vulnerabilities:
- **Severity Levels**: CRITICAL, HIGH, MEDIUM, LOW, INFO.
- **Problem**: Short description.
- **Line/Location**: Code snippet or line.
- **Recommendation**: How to fix it.

File to audit: ${file.filename}

Code:
\`\`\`
${content}
\`\`\`
`;

      try {
        const auditReport = await callLlm(prompt, apiProvider, apiKey, model);

        const commentBody = `### 🛡️ AI Crypto Auditor Report for \`${file.filename}\`
        
${auditReport}

*Audited automatically by [AI Crypto Auditor](https://github.com/${owner}/${repo}) using ${apiProvider} AI.*
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

