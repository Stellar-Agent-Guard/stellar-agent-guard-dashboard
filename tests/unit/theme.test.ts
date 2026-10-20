import assert from "node:assert/strict";
import { test, before, afterEach } from "node:test";
import { installDom, loadReact } from "./domHarness.ts";
import { ThemeProvider, useTheme } from "../../components/ThemeProvider.tsx";
import { readFileSync } from "node:fs";

let dom: ReturnType<typeof installDom>;
let React: Awaited<ReturnType<typeof loadReact>>["react"];
let createRoot: Awaited<ReturnType<typeof loadReact>>["createRoot"];
let act: Awaited<ReturnType<typeof loadReact>>["act"];
let root: ReturnType<typeof createRoot> | null = null;
let mediaQueryCallbacks: Set<Function> = new Set();
let matchMediaResult = false;

before(async () => {
  dom = installDom();
  const reactDeps = await loadReact();
  React = reactDeps.react;
  createRoot = reactDeps.createRoot;
  act = reactDeps.act;

  // Mock matchMedia
  window.matchMedia = ((query: string) => {
    return {
      matches: matchMediaResult,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (type: string, listener: Function) => {
        if (type === "change") mediaQueryCallbacks.add(listener);
      },
      removeEventListener: (type: string, listener: Function) => {
        if (type === "change") mediaQueryCallbacks.delete(listener);
      },
      dispatchEvent: () => true,
    } as any;
  }) as any;
});

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
  mediaQueryCallbacks.clear();
  matchMediaResult = false;
});

test("initializes with prefers-color-scheme when no localStorage", async () => {
  matchMediaResult = true; // prefers light
  const div = document.createElement("div");
  document.body.appendChild(div);
  root = createRoot(div);

  let currentTheme = "";
  function TestChild() {
    const { theme } = useTheme();
    currentTheme = theme;
    return React.createElement("div", null, theme);
  }

  await act(() => {
    root!.render(React.createElement(ThemeProvider, null, React.createElement(TestChild)));
  });

  assert.equal(currentTheme, "light");
  assert.equal(document.documentElement.getAttribute("data-theme"), "light");
});

test("initializes with localStorage if set", async () => {
  localStorage.setItem("theme", "high-contrast");
  matchMediaResult = true; // prefers light but localStorage should win

  const div = document.createElement("div");
  document.body.appendChild(div);
  root = createRoot(div);

  let currentTheme = "";
  function TestChild() {
    const { theme } = useTheme();
    currentTheme = theme;
    return React.createElement("div", null, theme);
  }

  await act(() => {
    root!.render(React.createElement(ThemeProvider, null, React.createElement(TestChild)));
  });

  assert.equal(currentTheme, "high-contrast");
  assert.equal(document.documentElement.getAttribute("data-theme"), "high-contrast");
});

test("updates theme and persists to localStorage on change", async () => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  root = createRoot(div);

  let setThemeFn: any;
  function TestChild() {
    const { setTheme } = useTheme();
    setThemeFn = setTheme;
    return null;
  }

  await act(() => {
    root!.render(React.createElement(ThemeProvider, null, React.createElement(TestChild)));
  });

  await act(() => {
    setThemeFn("dark");
  });

  assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(localStorage.getItem("theme"), "dark");
});

test("listens to media query changes if no localStorage set", async () => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  root = createRoot(div);

  await act(() => {
    root!.render(React.createElement(ThemeProvider, null, React.createElement("div")));
  });

  assert.equal(document.documentElement.getAttribute("data-theme"), "dark"); // initial matchMedia=false

  await act(() => {
    mediaQueryCallbacks.forEach((cb) => cb({ matches: true })); // Change to light
  });

  assert.equal(document.documentElement.getAttribute("data-theme"), "light");
});

test("status and severity tokens meet WCAG AA text contrast in every theme", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const hex = (value: string) => value.match(/#[\da-f]{6}/i)?.[0];
  const luminance = (color: string) => {
    const channels = color.slice(1).match(/../g)!.map((part) => parseInt(part, 16) / 255);
    const linear = channels.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const ratio = (a: string, b: string) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0]! + 0.05) / (values[1]! + 0.05);
  };
  const themes = [
    [":root {", "--bg: #0a0d12", "--text: #e6ebf2"],
    [":root[data-theme=\"light\"]", "--bg: #ffffff", "--text: #111827"],
    [":root[data-theme=\"high-contrast\"]", "--bg: #000000", "--text: #ffffff"],
  ] as const;
  for (const [selector, bgToken, textToken] of themes) {
    const start = css.indexOf(selector);
    assert.notEqual(start, -1, `theme selector exists: ${selector}`);
    const block = css.slice(start, css.indexOf("}", start));
    const bg = hex(block.slice(block.indexOf(bgToken.split(": ")[0]!), block.indexOf(";", block.indexOf(bgToken.split(": ")[0]!))));
    const foreground = hex(block.slice(block.indexOf(textToken.split(": ")[0]!), block.indexOf(";", block.indexOf(textToken.split(": ")[0]!))));
    assert.ok(bg && foreground && ratio(bg, foreground) >= 4.5, `${selector} body text contrast >= 4.5:1`);
    for (const token of ["ok", "warn", "danger"]) {
      const colorLine = block.match(new RegExp(`--${token}:\\s*(#[\\da-f]{6})`, "i"));
      assert.ok(colorLine, `${selector} defines --${token}`);
      assert.ok(ratio(bg, colorLine[1]!) >= 4.5, `${selector} --${token} contrast >= 4.5:1`);
    }
    const color = (name: string) => block.match(new RegExp(`--${name}:\\s*(#[\\da-f]{6})`, "i"))?.[1];
    assert.ok(ratio(color("accent")!, color("button-text")!) >= 4.5, `${selector} primary button contrast >= 4.5:1`);
    assert.ok(ratio(color("danger")!, color("danger-button-text")!) >= 4.5, `${selector} danger button contrast >= 4.5:1`);
    assert.ok(ratio(color("panel-2")!, color("muted")!) >= 4.5, `${selector} disabled control text contrast >= 4.5:1`);
  }
});
