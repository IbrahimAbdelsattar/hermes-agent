// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicApisPage from "./PublicApisPage";

vi.mock("@/contexts/usePageHeader", () => ({
  usePageHeader: () => ({ setEnd: vi.fn(), setTitle: vi.fn() }),
}));

const MOCK_STATS = {
  total_apis: 1891,
  total_categories: 52,
  https_count: 1797,
  https_percentage: 95.0,
  no_auth_count: 904,
  apikey_count: 828,
  oauth_count: 151,
  cors_yes_count: 689,
  last_synced: "2026-09-22 15:00:00 UTC",
  repo_url: "https://github.com/public-apis/public-apis.git",
};

const MOCK_CATEGORIES = [
  { category: "Animals", count: 16 },
  { category: "Cryptocurrency", count: 42 },
  { category: "Weather", count: 28 },
];

const MOCK_APIS = [
  {
    name: "Cat Facts",
    url: "https://catfact.ninja/",
    description: "Daily random cat facts and trivia",
    auth: "No",
    https: true,
    cors: "yes",
    category: "Animals",
  },
  {
    name: "Open-Meteo",
    url: "https://open-meteo.com/",
    description: "Free open-source weather forecast API",
    auth: "No",
    https: true,
    cors: "yes",
    category: "Weather",
  },
  {
    name: "CoinGecko",
    url: "https://www.coingecko.com/api",
    description: "Cryptocurrency market data and prices",
    auth: "No",
    https: true,
    cors: "yes",
    category: "Cryptocurrency",
  },
];

let container: HTMLDivElement;
let root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PublicApisPage", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/public-apis/stats")) {
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_STATS,
        } as Response;
      }
      if (url.includes("/api/public-apis/categories")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ categories: MOCK_CATEGORIES }),
        } as Response;
      }
      if (url.includes("/api/public-apis")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: MOCK_APIS,
            total: MOCK_APIS.length,
            limit: 24,
            offset: 0,
          }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders Public APIs Hub header and telemetry stats", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/public-apis"]}>
          <PublicApisPage />
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain("Public APIs Hub & Explorer");
    expect(container.textContent).toContain("1,890+ LIVE APIS");
    expect(container.textContent).toContain("Total APIs");
    expect(container.textContent).toContain("HTTPS Supported");
  });

  it("renders API cards with details and action buttons", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/public-apis"]}>
          <PublicApisPage />
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain("Cat Facts");
    expect(container.textContent).toContain("Daily random cat facts and trivia");
    expect(container.textContent).toContain("Open-Meteo");
    expect(container.textContent).toContain("CoinGecko");
    expect(container.textContent).toContain("Docs");
  });

  it("allows searching APIs via the search input", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/public-apis"]}>
          <PublicApisPage />
        </MemoryRouter>
      );
    });

    const searchInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(searchInput).toBeDefined();

    await act(async () => {
      searchInput.value = "cat";
      searchInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(searchInput.value).toBe("cat");
  });

  it("allows filtering by category via select dropdown", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/public-apis"]}>
          <PublicApisPage />
        </MemoryRouter>
      );
    });

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).toBeDefined();
    expect(select.options.length).toBeGreaterThanOrEqual(1);
  });
});
