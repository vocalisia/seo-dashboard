// GitHub API helper for publishing MDX files to repos

interface GitHubFileResponse {
  content: {
    html_url: string;
  };
}

interface GitHubErrorResponse {
  message: string;
}

export async function publishToGitHub(
  repo: string,
  path: string,
  content: string,
  message: string
): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN not configured");
    return null;
  }

  const encoded = Buffer.from(content, "utf8").toString("base64");

  const tryBranch = async (branch: string): Promise<string | null> => {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ message, content: encoded, branch }),
      }
    );

    if (res.status === 422) return null; // branch not found → try fallback
    if (!res.ok) {
      const err = (await res.json()) as GitHubErrorResponse;
      console.error(`GitHub PUT failed (${res.status}): ${err.message}`);
      return null;
    }

    const data = (await res.json()) as GitHubFileResponse;
    return data.content?.html_url ?? null;
  };

  const mainResult = await tryBranch("main");
  if (mainResult !== null) return mainResult;

  // Fallback to master
  return tryBranch("master");
}

export async function listRepoFiles(
  repo: string,
  dirPath: string
): Promise<string[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return [];

  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${dirPath}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!res.ok) return [];

  const data = (await res.json()) as { name: string; type: string }[];
  if (!Array.isArray(data)) return [];

  return data
    .filter((f) => f.type === "file" && f.name.endsWith(".mdx"))
    .map((f) => f.name.replace(/\.mdx$/, ""));
}
