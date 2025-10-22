"""
Code generation service with credential discovery and secure execution.
"""

import os
import json
import docker
import asyncio
from typing import Dict, List, Optional, Any
from anthropic import Anthropic


class CredentialDiscovery:
    """Discovers what credentials are needed for a coding task"""

    def __init__(self, anthropic_client: Anthropic):
        self.anthropic_client = anthropic_client

    async def discover_requirements(self, user_query: str, retrieve_docs_fn) -> Dict[str, Any]:
        """
        Analyze a coding task and identify all required credentials.

        Args:
            user_query: The user's coding request
            retrieve_docs_fn: Function to retrieve documentation

        Returns:
            Dictionary with:
            - credentials: List of required credentials
            - service: Service name
            - task_summary: Brief description
            - docs_url: Documentation URL
            - setup_steps: Steps to obtain credentials
        """

        # First, try to retrieve relevant documentation
        try:
            docs_context = retrieve_docs_fn(user_query)
        except Exception as e:
            print(f"Error retrieving docs: {e}")
            docs_context = ""

        # Build prompt for credential discovery
        docs_section = f'Additional context from documentation:\n{docs_context[:1000]}\n' if docs_context else ''

        prompt = f"""Analyze this coding task and identify ALL credentials needed:

Task: {user_query}

{docs_section}

Respond with a JSON object containing:
1. "credentials": List of all required credentials with:
   - "name": Variable name in UPPER_SNAKE_CASE (e.g., "API_KEY", "CLIENT_SECRET", "ACCESS_TOKEN")
   - "label": Human-readable name (e.g., "Twitter API Key")
   - "type": "secret" (hidden input) or "text" (visible input like client_id)
   - "description": Where to find this credential (be specific)
   - "required": true/false
2. "service": Service name (e.g., "Twitter API", "AWS", "Stripe")
3. "task_summary": Brief description of what code will do
4. "docs_url": Link to authentication documentation (if known)
5. "setup_steps": Array of steps to obtain credentials

Example response:
{{
  "credentials": [
    {{
      "name": "TWITTER_API_KEY",
      "label": "Twitter API Key",
      "type": "secret",
      "description": "Found in Twitter Developer Portal under Projects & Apps > Keys and tokens",
      "required": true
    }},
    {{
      "name": "TWITTER_API_SECRET",
      "label": "Twitter API Secret",
      "type": "secret",
      "description": "Found in Twitter Developer Portal under Projects & Apps > Keys and tokens",
      "required": true
    }}
  ],
  "service": "Twitter API",
  "task_summary": "Authenticate and post tweets using Twitter API v2",
  "docs_url": "https://developer.twitter.com/en/docs/authentication",
  "setup_steps": [
    "Create Twitter Developer account at developer.twitter.com",
    "Create a new app in Developer Portal",
    "Generate API Key and Secret under 'Keys and tokens' tab",
    "Set app permissions to 'Read and Write'"
  ]
}}

IMPORTANT:
- Only include credentials that are ACTUALLY needed for this specific task
- Use clear, descriptive variable names
- Be specific about where to find each credential
- If the task doesn't need credentials, return empty credentials array

Respond with ONLY valid JSON, no other text."""

        try:
            response = self.anthropic_client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0
            )

            # Extract JSON from response
            response_text = response.content[0].text

            # Try to find JSON in the response (in case there's extra text)
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1

            if json_start != -1 and json_end > json_start:
                json_text = response_text[json_start:json_end]
                requirements = json.loads(json_text)

                # Validate structure
                if not isinstance(requirements.get("credentials"), list):
                    raise ValueError("Invalid credentials format")

                return requirements
            else:
                raise ValueError("No JSON found in response")

        except Exception as e:
            print(f"Error discovering credentials: {e}")
            # Return minimal structure
            return {
                "credentials": [],
                "service": "Unknown",
                "task_summary": user_query,
                "docs_url": "",
                "setup_steps": ["Please configure credentials manually"]
            }


class SecureCodeGenerator:
    """Generates code with credential placeholders"""

    def __init__(self, anthropic_client: Anthropic):
        self.anthropic_client = anthropic_client

    async def generate_code_template(
        self,
        user_query: str,
        requirements: Dict[str, Any],
        retrieve_docs_fn
    ) -> str:
        """
        Generate Python code with environment variable placeholders.

        Args:
            user_query: The user's coding request
            requirements: Credential requirements from CredentialDiscovery
            retrieve_docs_fn: Function to retrieve documentation

        Returns:
            Python code as a string
        """

        credential_names = [cred['name'] for cred in requirements.get('credentials', [])]

        # Retrieve relevant documentation
        try:
            docs_context = retrieve_docs_fn(user_query)
        except Exception as e:
            print(f"Error retrieving docs: {e}")
            docs_context = ""

        # Build prompt for code generation
        docs_section = f'Documentation context:\n{docs_context[:2000]}\n' if docs_context else ''

        prompt = f"""Write complete, production-ready Python code for this task:

Task: {user_query}

Service: {requirements.get('service', 'Unknown')}

{docs_section}

Required credentials (load from environment variables):
{json.dumps(credential_names, indent=2)}

Requirements:
1. Load ALL credentials using: os.environ['CREDENTIAL_NAME']
2. Add proper error handling with try/except blocks
3. Include helpful print statements showing progress
4. Add clear comments explaining each step
5. Validate that all required environment variables are set at the start
6. Use best practices for the API/SDK being used
7. Make the code production-ready and secure

Example structure:
```python
import os
import sys

# Validate environment variables
required_vars = ['API_KEY', 'API_SECRET']
missing_vars = [var for var in required_vars if not os.environ.get(var)]
if missing_vars:
    print(f"Error: Missing environment variables: {{', '.join(missing_vars)}}")
    sys.exit(1)

# Load credentials
api_key = os.environ['API_KEY']
api_secret = os.environ['API_SECRET']

# Your code here...
```

Generate complete, runnable code. Respond with ONLY the Python code, no explanations."""

        try:
            response = self.anthropic_client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0
            )

            code_text = response.content[0].text

            # Extract code from markdown if present
            if '```python' in code_text:
                start = code_text.find('```python') + len('```python')
                end = code_text.find('```', start)
                code_text = code_text[start:end].strip()
            elif '```' in code_text:
                start = code_text.find('```') + 3
                end = code_text.find('```', start)
                code_text = code_text[start:end].strip()

            return code_text

        except Exception as e:
            print(f"Error generating code: {e}")
            raise


class SecureCodeExecutor:
    """Executes code in isolated Docker container"""

    def __init__(self):
        try:
            self.docker_client = docker.from_env()
        except Exception as e:
            print(f"Warning: Docker not available: {e}")
            self.docker_client = None

    async def execute(
        self,
        code: str,
        credentials: Dict[str, str],
        dependencies: List[str] = None,
        timeout: int = 30,
        memory_limit: str = '256m'
    ) -> Dict[str, Any]:
        """
        Execute Python code in isolated Docker container.

        Args:
            code: Python code to execute
            credentials: Dictionary of credential name -> value
            dependencies: List of pip dependencies to install (e.g., ['tweepy>=4.14.0'])
            timeout: Maximum execution time in seconds
            memory_limit: Memory limit (e.g., '256m', '512m')

        Returns:
            Dictionary with:
            - success: bool
            - output: stdout output
            - error: stderr output
            - exit_code: int
        """

        if not self.docker_client:
            return {
                "success": False,
                "output": "",
                "error": "Docker is not available",
                "exit_code": 1
            }

        try:
            # Create environment variables dict
            env_vars = {}
            for key, value in credentials.items():
                env_vars[key] = value

            print(f"Executing code in Docker container...")
            print(f"Environment variables: {list(env_vars.keys())}")

            # Create install script if dependencies are provided
            if dependencies:
                deps_list = ' '.join(dependencies)
                install_cmd = f"pip install --quiet --no-cache-dir {deps_list} && python -c '{code}'"
                command = ['sh', '-c', install_cmd]
                print(f"Installing dependencies: {deps_list}")
            else:
                command = ['python', '-c', code]

            # Run container with network temporarily enabled for pip install
            container = self.docker_client.containers.run(
                image='python:3.11-slim',
                command=command,
                environment=env_vars,
                network_disabled=False if dependencies else True,  # Enable network for pip install
                mem_limit=memory_limit,
                cpu_quota=50000,  # Limit CPU usage
                detach=True,
                remove=False,  # Don't auto-remove so we can get logs
                stdout=True,
                stderr=True
            )

            # Wait for execution with timeout
            try:
                result = container.wait(timeout=timeout)
                exit_code = result['StatusCode']

                # Get logs
                logs = container.logs(stdout=True, stderr=True).decode('utf-8')

                # Split stdout and stderr (Docker combines them)
                output = logs
                error = ""

                success = exit_code == 0

            except Exception as wait_error:
                print(f"Container wait error: {wait_error}")
                # Try to kill container
                try:
                    container.kill()
                except:
                    pass

                success = False
                output = ""
                error = f"Execution timeout ({timeout}s)"
                exit_code = 124

            finally:
                # Clean up container
                try:
                    container.remove(force=True)
                except Exception as cleanup_error:
                    print(f"Container cleanup error: {cleanup_error}")

            return {
                "success": success,
                "output": output,
                "error": error,
                "exit_code": exit_code
            }

        except Exception as e:
            print(f"Docker execution error: {e}")
            import traceback
            traceback.print_exc()
            return {
                "success": False,
                "output": "",
                "error": str(e),
                "exit_code": 1
            }

    def __del__(self):
        """Clean up Docker client"""
        if self.docker_client:
            try:
                self.docker_client.close()
            except:
                pass


class CodeRefiner:
    """Refines code based on execution errors"""

    def __init__(self, anthropic_client: Anthropic):
        self.anthropic_client = anthropic_client

    async def refine_code(
        self,
        original_code: str,
        execution_result: Dict[str, Any],
        user_query: str,
        max_iterations: int = 3
    ) -> tuple[str, List[Dict[str, Any]]]:
        """
        Refine code based on execution errors.

        Args:
            original_code: The original code that failed
            execution_result: Result from SecureCodeExecutor
            user_query: Original user request
            max_iterations: Maximum refinement attempts

        Returns:
            Tuple of (refined_code, iteration_history)
        """

        current_code = original_code
        history = []

        for iteration in range(max_iterations):
            if execution_result['success']:
                break

            print(f"Refinement iteration {iteration + 1}/{max_iterations}")

            # Build refinement prompt
            prompt = f"""The following Python code failed to execute:

```python
{current_code}
```

Execution result:
- Exit code: {execution_result['exit_code']}
- Output: {execution_result['output']}
- Error: {execution_result['error']}

Original task: {user_query}

Please fix the code to address these errors. Consider:
1. Missing imports or dependencies
2. API usage errors
3. Logic errors
4. Environment variable issues

Respond with ONLY the fixed Python code, no explanations."""

            try:
                response = self.anthropic_client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=2000,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0
                )

                refined_code = response.content[0].text

                # Extract code from markdown
                if '```python' in refined_code:
                    start = refined_code.find('```python') + len('```python')
                    end = refined_code.find('```', start)
                    refined_code = refined_code[start:end].strip()
                elif '```' in refined_code:
                    start = refined_code.find('```') + 3
                    end = refined_code.find('```', start)
                    refined_code = refined_code[start:end].strip()

                history.append({
                    "iteration": iteration + 1,
                    "error": execution_result['error'],
                    "code": refined_code
                })

                current_code = refined_code

            except Exception as e:
                print(f"Refinement error: {e}")
                break

        return current_code, history
