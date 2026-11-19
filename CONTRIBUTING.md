This project permits the use of Artificial Intelligence (AI) and Large Language Models (LLMs)—such as ChatGPT, Claude, GitHub Copilot, and Gemini—to assist in writing, refactoring, and documenting code. However, the human contributor must take ultimate responsibility for all submitted work and act as the sole author of record.

### 1. Core Rule: Human Attestation and Ownership

By submitting code to this repository, you personally attest that you fully understand the code, have verified its accuracy, and take complete responsibility for its behavior. AI agents and LLMs must never be credited as authors or co-authors in commit messages (e.g., using the Co-authored-by: git trailer).

### 2. Rationale

We encourage the use of modern development tools, but we enforce strict human ownership for the following reasons:

**Accountability:** A human contributor must be able to defend the architectural choices, troubleshoot edge cases, and maintain the code in the future. You cannot defer responsibility for bugs or logic errors to an AI.

**Security & Quality:** LLMs can confidently introduce subtle logical flaws, hallucinate vulnerabilities, or regurgitate outdated security practices. The human author is strictly responsible for auditing AI-generated code against our project's security and quality standards.

**Provenance:** For legal and maintainability purposes, the repository history must reflect the human developer who evaluated and approved the code's inclusion in the project.

### 3. Usage Guidelines

When contributing to this repository using AI assistance, you must adhere to the following standards:

**No AI Co-Authorship:** You must not include AI bots or tools in your commit headers (e.g., Co-authored-by: Claude <noreply@anthropic.com>). All commits must be attributed solely to you.

**Mandatory Review:** You may not blindly copy and paste AI-generated code. You must read, test, and thoroughly review all AI-assisted logic before opening a pull request.

**Equal Standards:** AI-assisted code is subject to the exact same rigorous review, linting, and testing requirements as fully human-written code. "The AI wrote it this way" is not an acceptable justification for failing tests, poor performance, or messy formatting.

### 4. Enforcement and Remediation

Any pull request discovered to contain AI co-author attributions will be closed or reverted. Contributors will be asked to amend their commit history to remove the AI attribution and formally take ownership of the code before it can be merged.

### 5. Contributor Acknowledgment

By submitting a pull request, you explicitly certify that you have reviewed and tested the provided code, you take full responsibility for its functionality and security, and you are the sole author of record.
