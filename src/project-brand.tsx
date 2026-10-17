import { createContext, useContext } from 'react';
import { AppLink } from './router';
export const ProjectTitleContext = createContext<string | null>(null);
export function projectDocsName(title?: string | null): string {
  const name = title?.trim();
  return name ? `${name} Docs` : 'Nessa Docs';
}
export const useDocsName = () => projectDocsName(useContext(ProjectTitleContext));
export function ProjectBrand({title, onHome}: {title: string; onHome: () => void}) {
  return <AppLink to="/" className="brand" aria-label="Nessa Docs" title={title} onClick={onHome}>
    <span className="brand-name">nessa</span><span className="brand-product">Docs</span>
  </AppLink>;
}
