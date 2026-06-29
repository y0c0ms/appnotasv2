// Shared AI HTTP transport.
//
// Every AI provider request is routed through the Rust `ai_http` command, whose
// reqwest client validates TLS against the OS certificate store. On corporate
// machines (e.g. Zscaler) the proxy's root CA lives in that store, so TLS
// interception is trusted and requests succeed — unlike browser `fetch` or the
// stock tauri-plugin-http path, which failed behind the proxy.

import { invoke } from '@tauri-apps/api/core';

export interface RustHttpResponse {
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    body: string;
}

export interface AiHttpOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
}

/** Low-level call into the Rust transport. */
export async function aiHttp(url: string, options: AiHttpOptions = {}): Promise<RustHttpResponse> {
    return invoke<RustHttpResponse>('ai_http', {
        req: {
            url,
            method: options.method ?? 'GET',
            headers: options.headers ?? {},
            body: options.body ?? null,
            timeout_ms: options.timeoutMs ?? null
        }
    });
}

/**
 * A `fetch`-compatible adapter backed by the Rust transport, so SDKs that accept
 * a custom fetch (e.g. @google/generative-ai) also benefit from the OS cert
 * store and proxy handling. Supports the subset of the Fetch API those SDKs use.
 */
export const rustFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    // Normalize headers from the various shapes RequestInit allows.
    const headers: Record<string, string> = {};
    if (init?.headers) {
        if (init.headers instanceof Headers) {
            init.headers.forEach((value, key) => { headers[key] = value; });
        } else if (Array.isArray(init.headers)) {
            for (const [key, value] of init.headers) headers[key] = value as string;
        } else {
            Object.assign(headers, init.headers as Record<string, string>);
        }
    }

    let body: string | undefined;
    if (init?.body != null) {
        body = typeof init.body === 'string' ? init.body : String(init.body);
    }

    const res = await aiHttp(url, {
        method: (init?.method ?? 'GET').toUpperCase(),
        headers,
        body
    });

    return new Response(res.body, {
        status: res.status,
        statusText: res.ok ? 'OK' : 'Error',
        headers: res.headers
    });
}) as typeof fetch;
