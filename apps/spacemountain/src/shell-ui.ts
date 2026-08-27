import { SpaceMountainShellUi as BaseShellUi, type SpaceMountainUiOptions } from "./shell-ui-base.js";
import type { SpaceMountainShellSnapshotV1 } from "./index.js";
import { OverlayBayParityController } from "./overlay-bay-ui.js";
export type { SpaceMountainUiOptions, SpaceMountainViewV1 } from "./shell-ui-base.js";

export class SpaceMountainShellUi {
  private readonly base: BaseShellUi;
  private readonly overlayBay: OverlayBayParityController;
  private observer?: MutationObserver;
  private snapshot: SpaceMountainShellSnapshotV1;

  constructor(private readonly options: SpaceMountainUiOptions) {
    this.snapshot = options.snapshot;
    this.base = new BaseShellUi(options);
    this.overlayBay = new OverlayBayParityController(options.root, this.snapshot);
  }

  mount() {
    this.base.mount();
    this.observe();
    this.overlayBay.mount();
    return this;
  }

  update(snapshot: SpaceMountainShellSnapshotV1) {
    this.snapshot = snapshot;
    this.base.update(snapshot);
    this.overlayBay.update(snapshot);
  }

  destroy() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.base.destroy();
  }

  private observe() {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => queueMicrotask(() => this.overlayBay.mount()));
    this.observer.observe(this.options.root, { childList: true, subtree: true });
  }
}
