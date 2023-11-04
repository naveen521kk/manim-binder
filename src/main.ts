// most of this code is copied from https://github.com/ines/juniper
// MIT License

import { basicSetup } from "codemirror";
import { python } from "@codemirror/lang-python";
import { lineNumbers } from "@codemirror/view";
import { keymap, EditorView } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";

import {
  ServerConnection,
  KernelManager,
  ContentsManager,
} from "@jupyterlab/services";
import { OutputArea, OutputAreaModel } from "@jupyterlab/outputarea";
import {
  RenderMimeRegistry,
  standardRendererFactories,
} from "@jupyterlab/rendermime";

import type { IRenderMime } from "@jupyterlab/rendermime";
import type { IKernelConnection } from "@jupyterlab/services/lib/kernel/kernel";

import { Widget } from "@lumino/widgets";
import { MessageLoop } from "@lumino/messaging";

const REPO = "ManimCommunity/jupyter_examples";
const BRANCH = "main";

(function () {
  const STORAGE_EXPIRE = 60;
  const STORAGE_KEY = "manim-notebook-kernel";
  const KERNEL_TYPE = "python3";
  const DEFAULT_CLASS_NAMES = {
    cell: "manim-binder-cell",
    input: "manim-binder-input",
    button: "manim-binder-button",
    output: "manim-binder-output",
    wrapper: "manim-binder-wrapper",
    title: "manim-binder-title",
    meta: "manim-binder-meta",
  };
  const DEFAULT_URL = "https://mybinder.org";

  let _fromStorage = false;
  let _kernel: IKernelConnection | null = null;
  let _kernel_manager: KernelManager | null = null;
  let _renderers: IRenderMime.IRendererFactory[] | null = null;
  let _contents_manager: ContentsManager | null = null;

  function requestBinder(
    repo: string,
    branch: string,
    url: string = DEFAULT_URL
  ) {
    const binderUrl = `${url}/build/gh/${repo}/${branch}`;
    return new Promise<{
      baseUrl: string;
      wsUrl: string;
      token: string;
    }>((resolve, reject) => {
      const es = new EventSource(binderUrl);
      es.onerror = (_) => {
        es.close();
        reject(new Error("Unable to connect to Binder"));
      };
      let phase: string | null = null;
      es.onmessage = ({ data }) => {
        const msg = JSON.parse(data);
        if (msg.phase && msg.phase != phase) {
          phase = msg.phase.toLowerCase();
        }
        if (msg.phase == "failed") {
          es.close();
          reject(new Error(msg));
        } else if (msg.phase == "ready") {
          es.close();
          const settings = {
            baseUrl: msg.url,
            wsUrl: `ws${msg.url.slice(4)}`,
            token: msg.token,
          };
          resolve(settings);
        }
      };
    });
  }

  function requestKernel(settings: {
    baseUrl: string;
    wsUrl: string;
    token: string;
  }) {
    if (typeof window !== "undefined") {
      const timestamp = new Date().getTime() + STORAGE_EXPIRE * 60 * 1000;
      const json = JSON.stringify({ settings, timestamp });
      window.localStorage.setItem(STORAGE_KEY, json);
    }
    const serverSettings = ServerConnection.makeSettings(settings);
    _kernel_manager = new KernelManager({ serverSettings });
    _contents_manager = new ContentsManager({ serverSettings });
    return _kernel_manager
      .startNew({
        name: KERNEL_TYPE,
      })
      .then((kernel) => {
        return kernel;
      });
  }

  function getKernel() {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        _fromStorage = true;
        const { settings, timestamp } = JSON.parse(stored);
        if (timestamp && new Date().getTime() < timestamp) {
          return requestKernel(settings);
        }
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    return requestBinder(REPO, BRANCH, DEFAULT_URL).then((settings) =>
      requestKernel(settings)
    );
  }

  function _$(tag: string, classNames: string = "", textContent: string = "") {
    const el = document.createElement(tag);
    el.className = classNames;
    el.textContent = textContent;
    return el;
  }

  function renderCell(element: HTMLElement) {
    const outputArea = new OutputArea({
      model: new OutputAreaModel({ trusted: true }),
      rendermime: new RenderMimeRegistry({
        initialFactories: getRenderers(),
      }),
    });

    const $wrapper = _$("div", DEFAULT_CLASS_NAMES.wrapper);
    element.replaceWith($wrapper);

    const $title = _$("h4", DEFAULT_CLASS_NAMES.title, "Try out manim!");
    $wrapper.appendChild($title);

    const $meta = _$("span", DEFAULT_CLASS_NAMES.meta, "Python 3 · via ");
    $title.appendChild($meta);

    const $link = _$("a", "", "Binder");
    $link.setAttribute("href", DEFAULT_URL);
    $meta.appendChild($link);

    const $cell = _$("div", DEFAULT_CLASS_NAMES.cell);
    $wrapper.appendChild($cell);
    const $input = _$("div", DEFAULT_CLASS_NAMES.input);
    $cell.appendChild($input);
    const $button = _$("button", DEFAULT_CLASS_NAMES.button, "Run");
    $cell.appendChild($button);
    const $output = _$("div", DEFAULT_CLASS_NAMES.output);
    $cell.appendChild($output);

    MessageLoop.sendMessage(outputArea, Widget.Msg.BeforeAttach);
    $output.appendChild(outputArea.node);
    MessageLoop.sendMessage(outputArea, Widget.Msg.AfterAttach);

    // when a <video> is added to the output area, change it's
    // src to include the base url
    outputArea.model.changed.connect(() => {
      $output.querySelectorAll("video").forEach(async (video) => {
        console.log("fixing video");
        const src = video.getAttribute("src");
        if (!src) {
          console.error("no src for the video.");
          return;
        }

        // set the max width to 100%
        video.style.maxWidth = "100%";

        // get the video data
        const fileData = await _contents_manager!.get(src);
        if (!fileData.mimetype.startsWith("video/")) {
          console.error("not a video");
          return;
        }

        const binaryData = atob(fileData.content);

        const arrayBuffer = new ArrayBuffer(binaryData.length);
        const uint8Array = new Uint8Array(arrayBuffer);
        for (let i = 0; i < binaryData.length; i++) {
          uint8Array[i] = binaryData.charCodeAt(i);
        }

        const videoBlob = new Blob([uint8Array], { type: fileData.mimetype });
        const videoUrl = URL.createObjectURL(videoBlob);
        console.log("video url", videoUrl);
        video.setAttribute("src", videoUrl);
      });
    });

    const cm: EditorView = new EditorView({
      extensions: [
        basicSetup,
        python(),
        oneDark,
        lineNumbers(),
        history(),
        keymap.of([
          {
            key: "Shift-Enter",
            run: () => {
              execute(outputArea, cm.state.doc.toString());
              return true;
            },
          },
          {
            key: "Ctrl-Enter",
            run: () => {
              execute(outputArea, cm.state.doc.toString());
              return true;
            },
          },
        ]),
        keymap.of([...defaultKeymap, ...historyKeymap]),
      ],
      parent: $input,
    });
    cm.contentDOM.setAttribute("data-enable-grammarly", "false");

    // set value
    cm.dispatch({
      changes: {
        from: 0,
        to: cm.state.doc.length,
        insert: (element.textContent || "").trim(),
      },
    });

    const runCode = (_: any) => execute(outputArea, cm.state.doc.toString());
    // cm.setOption("extraKeys", { "Shift-Enter": runCode });
    $button.addEventListener("click", runCode);
  }

  async function render(outputArea: OutputArea, code: string) {
    // run `from manim import *` first
    const t = _kernel!.requestExecute({ code: "from manim import *" });
    await t.done;
    console.log("Import done. Now running code");
    outputArea.future = _kernel!.requestExecute({ code });
    outputArea.model.add({
      output_type: "stream",
      name: "loading",
      text: "Loading...",
    });
    outputArea.model.clear(true);
  }

  function execute(outputArea: OutputArea, code: string) {
    if (_kernel) {
      outputArea.model.clear();
      outputArea.model.add({
        output_type: "stream",
        name: "loading",
        text: "Loading...",
      });
      render(outputArea, code);
      return;
    }
    const url = DEFAULT_URL.split("//")[1];
    const action = !_fromStorage ? "Launching" : "Reconnecting to";
    outputArea.model.clear();
    outputArea.model.add({
      output_type: "stream",
      name: "stdout",
      text: `${action} Docker container on ${url}...`,
    });

    new Promise<IKernelConnection>((resolve, reject) =>
      getKernel().then(resolve).catch(reject)
    )
      .then((kernel) => {
        _kernel = kernel;
        render(outputArea, code);
      })
      .catch(() => {
        _kernel = null;
        if (typeof window !== "undefined") {
          _fromStorage = false;
          window.localStorage.removeItem(STORAGE_KEY);
        }
        outputArea.model.clear();
        outputArea.model.add({
          output_type: "stream",
          name: "failure",
          text: "Failed to connect to kernel",
        });
      });
  }

  function getRenderers() {
    if (!_renderers) {
      _renderers = standardRendererFactories.filter((factory) =>
        factory.mimeTypes.includes("text/latex")
          ? // @ts-ignore
            typeof window !== "undefined" && window.MathJax
          : true
      );
    }
    return _renderers;
  }

  function setStyles() {
    // create a <style> element
    const style = document.createElement("style");
    style.textContent = `
      .${DEFAULT_CLASS_NAMES.wrapper} {
        padding: 10px;
      }

      .${DEFAULT_CLASS_NAMES.title} {
        text-align: center;
        display: flex;
        justify-content: space-between;
      }

      .${DEFAULT_CLASS_NAMES.meta} {
        font-size: 0.75rem;
        font-weight: 400;
        padding-top: 0.1rem;
        color: #666;
      }

      .${DEFAULT_CLASS_NAMES.button} {
        cursor: pointer;
      }
    `;

    document.head.appendChild(style);
  }

  setStyles();
  const allCells = [...document.querySelectorAll("[data-interactive]")];
  allCells.forEach((cell) => renderCell(cell as HTMLElement));
})();
