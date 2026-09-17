// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JarvisCoreWidget } from "./JarvisCoreWidget";

let container: HTMLDivElement;
let root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("JarvisCoreWidget", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders Jarvis Chief of Staff and Pomodoro focus timer", async () => {
    await act(async () => {
      root.render(<JarvisCoreWidget />);
    });

    expect(container.textContent).toContain("JARVIS CHIEF OF STAFF");
    expect(container.textContent).toContain("MARK 85");
    expect(container.textContent).toContain("FOCUS GOAL");
    expect(container.textContent).toContain("DEEP WORK");
    expect(container.textContent).toContain("COMMANDS:");
  });

  it("switches to topology view", async () => {
    await act(async () => {
      root.render(<JarvisCoreWidget />);
    });

    const topologyBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Topology")
    );
    expect(topologyBtn).toBeDefined();

    await act(async () => {
      topologyBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain("HOLOGRAPHIC NEURAL TOPOLOGY");
    expect(container.textContent).toContain("7 NODES ACTIVE");
  });

  it("triggers deep work mode toggle", async () => {
    await act(async () => {
      root.render(<JarvisCoreWidget />);
    });

    const deepWorkBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("DEEP WORK")
    );
    expect(deepWorkBtn).toBeDefined();

    await act(async () => {
      deepWorkBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(deepWorkBtn?.className).toContain("bg-amber-400");
  });
});
