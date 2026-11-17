// 오프라인 개발 환경 전용 최소 타입 선언. @types/react 를 설치할 수 있으면 이 파일을 삭제하십시오.
declare module "react" {
  export type ReactNode = any;
  export type FC<P = {}> = (props: P) => any;
  export type ChangeEvent<T = any> = { target: T & { value: string; checked: boolean; files: FileList | null } };
  export function useState<T>(init: T | (() => T)): [T, (v: T | ((p: T) => T)) => void];
  export function useState<T = undefined>(): [T | undefined, (v: T | undefined | ((p: T | undefined) => T | undefined)) => void];
  export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(fn: () => T, deps: unknown[]): T;
  export function useRef<T>(init: T): { current: T };
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: unknown[]): T;
  export const Fragment: any;
  export const StrictMode: any;
  const React: any;
  export default React;
}
declare module "react/jsx-runtime" { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module "react-dom/client" { export function createRoot(el: Element): { render(n: any): void }; }
declare namespace JSX { interface IntrinsicElements { [k: string]: any } type Element = any; interface ElementChildrenAttribute { children: {} } interface IntrinsicAttributes { key?: any } }
