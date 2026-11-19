import { memo, useLayoutEffect, useState, useSyncExternalStore } from "react";
import ErrorBoundary from "../ErrorBoundary";
import { FeatureError } from "./FeatureBoundary";

/** A guarded data source publishes independently of the workspace it feeds. */
export function createIsolatedResource<T extends { error: string | null }>(name: string, useValue: () => T, initial: T) {
  type Snapshot = { value: T; failure: Error | null };
  class Resource {
    snapshot: Snapshot = { value: initial, failure: null };
    listeners = new Set<() => void>();
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    read = () => this.snapshot;
    publish(value: T) {
      this.snapshot = { value, failure: null };
      this.listeners.forEach(listener => listener());
    }
    fail = (failure: Error) => {
      // Keep cached reads, but callers use the initial rejecting actions while failed.
      this.snapshot = { value: this.snapshot.value, failure };
      this.listeners.forEach(listener => listener());
    };
  }
  const Controller = memo(function Controller({ resource }: { resource: Resource }) {
    const value = useValue();
    useLayoutEffect(() => resource.publish(value), [resource, value]);
    return null;
  });
  const Host = memo(function Host({ resource }: { resource: Resource }) {
    return <ErrorBoundary feature={name} onError={resource.fail} fallback={(error, retry) =>
      <FeatureError feature={name} error={error} retry={retry} />
    }><Controller resource={resource} /></ErrorBoundary>;
  });
  function useResource() {
    const [resource] = useState(() => new Resource());
    const { value, failure } = useSyncExternalStore(resource.subscribe, resource.read, resource.read);
    const guarded = failure ? { ...value, error: failure.message } : value;
    // Actions from a crashed hook no longer have a mounted owner.
    if (failure) for (const key of Object.keys(initial) as (keyof T)[]) {
      if (typeof initial[key] === "function") guarded[key] = initial[key];
    }
    return { value: guarded, host: <Host resource={resource} /> };
  }
  return useResource;
}
