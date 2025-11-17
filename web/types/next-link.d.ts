import type React from "react";
import type { AnchorHTMLAttributes, RefAttributes } from "react";
import type { UrlObject } from "url";

type Href = string | UrlObject;

type NextLinkBaseProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: Href;
  as?: Href;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  prefetch?: boolean;
  locale?: string | false;
  legacyBehavior?: boolean;
};

declare const Link: React.ForwardRefExoticComponent<
  NextLinkBaseProps & RefAttributes<HTMLAnchorElement>
>;

declare namespace Link {
  export type Props = NextLinkBaseProps;
}

declare module "next/link" {
  export type LinkProps = NextLinkBaseProps;
  export default Link;
}
