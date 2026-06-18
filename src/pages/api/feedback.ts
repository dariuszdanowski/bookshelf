import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { apiError, apiResponse } from '../../lib/http/response';
import { FeedbackSchema } from '../../lib/feedback/schema';

export const prerender = false;

const GITHUB_API_URL = 'https://api.github.com/repos/dariuszdanowski/bookshelf/issues';

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  if (!env.GITHUB_TOKEN) {
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 503,
      message: 'GitHub integration not configured.',
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError({ code: 'VALIDATION_ERROR', status: 400, message: 'Invalid JSON body.' });
  }

  const parsed = FeedbackSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Invalid feedback input.',
      details: parsed.error.flatten(),
    });
  }

  const { title, description, url } = parsed.data;

  const bodyLines = [`## Opis\n\n${description}`];
  if (url) {
    bodyLines.push(`## URL\n\n${url}`);
  }
  bodyLines.push(`## Zgłoszone przez\n\nUser ID: ${locals.user.id}`);
  bodyLines.push(`## Data\n\n${new Date().toISOString()}`);

  const issueBody = bodyLines.join('\n\n');

  let githubResponse: Response;
  try {
    githubResponse = await fetch(GITHUB_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `Bug: ${title}`,
        body: issueBody,
        labels: ['bug'],
      }),
    });
  } catch (err) {
    console.error('[api/feedback POST] GitHub fetch failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się połączyć z GitHub.',
    });
  }

  if (!githubResponse.ok) {
    console.error('[api/feedback POST] GitHub API error', {
      status: githubResponse.status,
    });
    return apiError({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Nie udało się utworzyć zgłoszenia.',
    });
  }

  const issue = (await githubResponse.json()) as { number: number; html_url: string };

  return apiResponse({
    data: {
      issueNumber: issue.number,
      issueUrl: issue.html_url,
    },
    status: 201,
  });
};
