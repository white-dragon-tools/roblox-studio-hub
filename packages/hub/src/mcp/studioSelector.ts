const PORT = parseInt(process.env.STUDIO_HUB_PORT || "35888", 10);

interface StudioEntry {
  readonly id: string;
  readonly placeName: string;
  readonly type: "place" | "local";
  readonly placeId?: number;
}

interface StudioListResponse {
  readonly studios: readonly StudioEntry[];
}

/**
 * Hub HTTP API URL
 */
export function getHubBaseUrl(): string {
  return `http://localhost:${PORT}`;
}

/**
 * 从 Hub API 获取当前连接的 Studio 列表
 */
async function fetchStudios(): Promise<readonly StudioEntry[]> {
  const url = `${getHubBaseUrl()}/api/studios`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Hub API 请求失败: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as StudioListResponse;
  return data.studios;
}

/**
 * 选择目标 Studio
 *
 * - 单个 Studio → 自动选择
 * - 多个 Studio + studioId → 验证并返回
 * - 多个 Studio + 无 studioId → 报错并列出可用 Studio
 * - 无 Studio → 报错
 */
export async function selectStudio(studioId?: string): Promise<string> {
  const studios = await fetchStudios();

  if (studios.length === 0) {
    throw new Error(
      "没有连接的 Studio。请先使用 'roblox-studio-hub open <place.rbxl>' 打开 Studio。",
    );
  }

  if (studios.length === 1) {
    return studios[0].id;
  }

  // 多个 Studio
  if (studioId) {
    const found = studios.find((s) => s.id === studioId);
    if (!found) {
      const available = studios
        .map((s) => `  - ${s.id} (${s.placeName})`)
        .join("\n");
      throw new Error(
        `Studio "${studioId}" 不存在。可用的 Studio:\n${available}`,
      );
    }
    return found.id;
  }

  // 多个 Studio，未指定 studioId
  const available = studios
    .map((s) => `  - ${s.id} (${s.placeName})`)
    .join("\n");
  throw new Error(
    `多个 Studio 连接中，请通过 _studioId 参数指定目标:\n${available}`,
  );
}

/**
 * 通过 Hub API 调用 Studio 方法
 */
export async function callStudioMethod(
  studioId: string,
  method: string,
  params: Record<string, unknown>,
  timeout = 30,
): Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
}> {
  const url = `${getHubBaseUrl()}/api/studios/${encodeURIComponent(studioId)}/call`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params, timeout }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ??
        `Hub API 调用失败: ${response.status}`,
    );
  }

  return (await response.json()) as {
    success: boolean;
    result?: unknown;
    error?: string;
  };
}
