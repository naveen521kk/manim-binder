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

interface ManimBinderClassNames {
  cell: string;
  input: string;
  button: string;
  output: string;
  wrapper: string;
  title: string;
  meta: string;
  buttonWrapper: string;
}

interface initManimBinderOptions {
  repo?: string;
  branch?: string;
  storage_expire?: number;
  storage_key?: string;
  kernel_type?: string;
  class_names?: ManimBinderClassNames;
  binder_url?: string;
}

interface CustomWindow extends Window {
  initManimBinder: (options?: initManimBinderOptions) => void;
}

const DEFAULT_REPO = "ManimCommunity/jupyter_examples";
const DEFAULT_BRANCH = "main";
const DEFAULT_STORAGE_EXPIRE = 60;
const DEFAULT_STORAGE_KEY = "manim-notebook-kernel";
const DEFAULT_KERNEL_TYPE = "python3";
const DEFAULT_CLASS_NAMES: ManimBinderClassNames = {
  cell: "manim-binder-cell",
  input: "manim-binder-input",
  button: "manim-binder-button",
  output: "manim-binder-output",
  wrapper: "manim-binder-wrapper",
  title: "manim-binder-title",
  meta: "manim-binder-meta",
  buttonWrapper: "manim-binder-button-wrapper",
};
const DEFAULT_BINDER_URL = "https://mybinder.org";

(function (window: CustomWindow) {
  let repo = DEFAULT_REPO;
  let branch = DEFAULT_BRANCH;
  let storage_expire = DEFAULT_STORAGE_EXPIRE;
  let storage_key = DEFAULT_STORAGE_KEY;
  let kernel_type = DEFAULT_KERNEL_TYPE;
  let class_names = DEFAULT_CLASS_NAMES;
  let binder_url = DEFAULT_BINDER_URL;

  let _fromStorage = false;
  let _kernel: IKernelConnection | null = null;
  let _kernel_manager: KernelManager | null = null;
  let _renderers: IRenderMime.IRendererFactory[] | null = null;
  let _contents_manager: ContentsManager | null = null;

  function requestBinder(
    repo: string,
    branch: string,
    url: string = binder_url
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
      const timestamp = new Date().getTime() + storage_expire * 60 * 1000;
      const json = JSON.stringify({ settings, timestamp });
      window.localStorage.setItem(storage_key, json);
    }
    const serverSettings = ServerConnection.makeSettings(settings);
    _kernel_manager = new KernelManager({ serverSettings });
    _contents_manager = new ContentsManager({ serverSettings });
    return _kernel_manager
      .startNew({
        name: kernel_type,
      })
      .then((kernel) => {
        return kernel;
      });
  }

  function getKernel() {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(storage_key);
      if (stored) {
        _fromStorage = true;
        const { settings, timestamp } = JSON.parse(stored);
        if (timestamp && new Date().getTime() < timestamp) {
          return requestKernel(settings);
        }
        window.localStorage.removeItem(storage_key);
      }
    }
    return requestBinder(repo, branch, binder_url).then((settings) =>
      requestKernel(settings)
    );
  }

  function _$(tag: string, classNames: string = "", textContent: string = "") {
    const el = document.createElement(tag);
    el.className = classNames;
    el.textContent = textContent;
    return el;
  }

  function renderCell(element: HTMLElement, code: string = "") {
    const outputArea = new OutputArea({
      model: new OutputAreaModel({ trusted: true }),
      rendermime: new RenderMimeRegistry({
        initialFactories: getRenderers(),
      }),
    });

    const $wrapper = _$("div", class_names.wrapper);
    element.replaceWith($wrapper);

    const $title = _$("h4", class_names.title, "Try out manim!");
    $wrapper.appendChild($title);

    const $meta = _$("span", class_names.meta, "Python 3 · via ");
    $title.appendChild($meta);

    const $link = _$("a", "", "Binder");
    $link.setAttribute("href", binder_url);
    $meta.appendChild($link);

    const $cell = _$("div", class_names.cell);
    $wrapper.appendChild($cell);
    const $input = _$("div", class_names.input);
    $cell.appendChild($input);
    const $button = _$("button", class_names.button, "Run");
    $cell.appendChild($button);
    const $output = _$("div", class_names.output);
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
        insert: code.trim(),
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
    const url = binder_url.split("//")[1];
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
          window.localStorage.removeItem(storage_key);
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
      .${class_names.wrapper} {
        padding: 10px;
      }

      .${class_names.title} {
        text-align: center;
        display: flex;
        justify-content: space-between;
      }

      .${class_names.meta} {
        font-size: 0.75rem;
        font-weight: 400;
        padding-top: 0.1rem;
        color: #666;
      }

      .${class_names.button} {
        cursor: pointer;
      }
    `;

    document.head.appendChild(style);
  }

  function renderMakeInteractiveButton(element: HTMLElement) {
    // get manim classname from data-manim-classname attribute
    const manimClassname = element.getAttribute("data-manim-classname");
    if (!manimClassname) {
      console.error("No manim classname provided.");
      return;
    }

    const wrapperDiv = _$("div", class_names.buttonWrapper);
    element.replaceWith(wrapperDiv);

    const makeInteractiveButton = _$(
      "button",
      class_names.button,
      "Make interactive"
    );
    wrapperDiv.appendChild(makeInteractiveButton);

    const makeInteractive = (_: any) => {
      let code = element.textContent || "";
      code += `\n\n# don't remove below command for run button to work`;
      code += `\n%manim -qm -v WARNING ${manimClassname}`;
      renderCell(wrapperDiv, code);
    };
    makeInteractiveButton.addEventListener("click", makeInteractive);
  }

  function initManimBinder({
    repo: _repo,
    branch: _branch,
    storage_expire: _storage_expire,
    storage_key: _storage_key,
    kernel_type: _kernel_type,
    class_names: _class_names,
    binder_url: _binder_url,
  }: initManimBinderOptions = {}) {
    repo = _repo || repo;
    branch = _branch || branch;
    storage_expire = _storage_expire || storage_expire;
    storage_key = _storage_key || storage_key;
    kernel_type = _kernel_type || kernel_type;
    class_names = _class_names || class_names;
    binder_url = _binder_url || binder_url;

    setStyles();

    const allCells = [...document.querySelectorAll("[data-manim-binder]")];
    allCells.forEach((cell) =>
      renderMakeInteractiveButton(cell as HTMLElement)
    );
  }

  window.initManimBinder = initManimBinder;
})(window as unknown as CustomWindow);
