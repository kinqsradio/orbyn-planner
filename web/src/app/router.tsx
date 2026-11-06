import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface Router {
  path: string;
  navigate: (to: string) => void;
}

const RouterContext = createContext<Router | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    if (to !== window.location.pathname) window.history.pushState(null, "", to);
    setPath(to);
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (!router) throw new Error("useRouter needs a RouterProvider");
  return router;
}

export function Link({ to, className, children, onClick, ...rest }: { to: string } & Omit<React.ComponentProps<"a">, "href">) {
  const { path, navigate } = useRouter();
  const current = path === to || (to === "/today" && path === "/") || (to !== "/today" && path.startsWith(`${to}/`));
  const classes = [className, current ? "on" : ""].filter(Boolean).join(" ");
  return (
    <a
      {...rest}
      href={to}
      className={classes}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
