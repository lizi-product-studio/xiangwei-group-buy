import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ImageInstance {
  data: { autoAspect: boolean; resolvedSrc: string; sourceVersion: number; imageAspectStyle: string };
  setData: (patch: Record<string, unknown>) => void;
}

interface ImageComponentDefinition {
  methods: {
    loadedImage(this: ImageInstance, event: WechatMiniprogram.ImageLoad): void;
    failedImage(this: ImageInstance, event: WechatMiniprogram.ImageError): void;
  };
}

describe('product image natural aspect sizing', () => {
  let component: ImageComponentDefinition | undefined;

  beforeEach(() => {
    vi.resetModules();
    component = undefined;
    vi.stubGlobal('Component', (definition: ImageComponentDefinition) => {
      component = definition;
      return definition;
    });
  });

  async function loadComponent(): Promise<ImageComponentDefinition> {
    await import('./index');
    if (!component) throw new Error('product image component was not registered');
    return component;
  }

  it('sets the loaded original image aspect ratio after a valid load event', async () => {
    const definition = await loadComponent();
    const setData = vi.fn();
    const instance: ImageInstance = {
      data: { autoAspect: true, resolvedSrc: 'https://example.test/eraser.jpg', sourceVersion: 3, imageAspectStyle: 'aspect-ratio: 1.65 / 1;' },
      setData,
    };

    definition.methods.loadedImage.call(instance, {
      currentTarget: { dataset: { src: instance.data.resolvedSrc, version: '3' } },
      detail: { width: 1200, height: 1600 },
    } as unknown as WechatMiniprogram.ImageLoad);

    expect(setData).toHaveBeenCalledWith({ loaded: true, imageAspectStyle: 'aspect-ratio: 1200 / 1600;' });
  });

  it('restores a bounded placeholder ratio after an image load error', async () => {
    const definition = await loadComponent();
    const setData = vi.fn();
    const instance: ImageInstance = {
      data: { autoAspect: true, resolvedSrc: 'https://example.test/eraser.jpg', sourceVersion: 3, imageAspectStyle: 'aspect-ratio: 1200 / 1600;' },
      setData,
    };

    definition.methods.failedImage.call(instance, {
      currentTarget: { dataset: { src: instance.data.resolvedSrc, version: '3' } },
    } as unknown as WechatMiniprogram.ImageError);

    expect(setData).toHaveBeenCalledWith({ failed: true, loaded: false, imageAspectStyle: 'aspect-ratio: 1.65 / 1;' });
  });
});
