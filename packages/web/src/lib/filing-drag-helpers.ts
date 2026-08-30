import { DRAG_MIME } from './drag';

/** Minimal DataTransfer stub for jsdom drag tests. */
export function makeDataTransfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData(type: string, value: string) {
      data.set(type, value);
    },
    getData(type: string) {
      return data.get(type) ?? '';
    },
    setDragImage() {
      // jsdom stub — InboxCard sets a custom drag image in browsers.
    },
  } as DataTransfer;
}

/** Dispatch a finalize event in the shape svelte-dnd-action expects. */
export function dispatchDndFinalize(zone: HTMLElement, items: unknown[]) {
  zone.dispatchEvent(
    new CustomEvent('finalize', {
      detail: {
        items,
        info: { source: 'pointer', trigger: 'droppedIntoZone', id: '' },
      },
      bubbles: true,
    }),
  );
}

/** jsdom lacks matchMedia; stub the bits our components need. */
export function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

/** Fire pointerdown (optional) then dragstart on `row`, returning the transfer. */
export function dragStartFrom(
  row: HTMLElement,
  options?: { target?: EventTarget; pointerTarget?: EventTarget },
) {
  if (options?.pointerTarget) {
    const pointer = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(pointer, 'target', { value: options.pointerTarget });
    row.dispatchEvent(pointer);
  }

  const dataTransfer = makeDataTransfer();
  const event = new DragEvent('dragstart', {
    bubbles: true,
    cancelable: true,
    dataTransfer,
  });
  if (options?.target) {
    Object.defineProperty(event, 'target', { value: options.target });
  }
  row.dispatchEvent(event);
  return dataTransfer;
}

/** Simulate a filing drop onto a sidebar collection button. */
export function dropOntoCollectionButton(
  button: HTMLElement,
  itemId: string,
  onDrop: (e: DragEvent) => void | Promise<void>,
) {
  const dataTransfer = makeDataTransfer();
  dataTransfer.setData(DRAG_MIME, itemId);
  const dragOver = new DragEvent('dragover', {
    bubbles: true,
    cancelable: true,
    dataTransfer,
  });
  button.dispatchEvent(dragOver);
  const drop = new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer,
  });
  Object.defineProperty(drop, 'currentTarget', { value: button });
  return onDrop(drop);
}

/** Whether a bubbling mousedown from `source` is cancelled before `zone`. */
export function mousedownReachesZoneUncancelled(
  zone: HTMLElement,
  source: HTMLElement,
) {
  let prevented = false;
  const handler = (e: MouseEvent) => {
    if (e.defaultPrevented) prevented = true;
  };
  zone.addEventListener('mousedown', handler);
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'target', { value: source });
  source.dispatchEvent(event);
  zone.removeEventListener('mousedown', handler);
  return !prevented && !event.defaultPrevented;
}
