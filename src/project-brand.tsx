import { createContext, useContext } from 'react';
import './project-brand.css';
import { AppLink } from './router';
export const ProjectTitleContext = createContext<string | null>(null);
export function projectDocsName(title?: string | null): string {
  const name = title?.trim();
  return name ? `${name} Docs` : 'Nessa Docs';
}
export const useDocsName = () => projectDocsName(useContext(ProjectTitleContext));
export function ProjectBrand({title, onHome}: {title: string; onHome: () => void}) {
  const projectTitle = useContext(ProjectTitleContext);
  return <AppLink to="/" className={`brand ${projectTitle ? 'project-brand' : ''}`} aria-label={projectDocsName(projectTitle)} title={title} onClick={onHome}>
    <span className="brand-name" dir="auto">{projectTitle || 'nessa'}</span><span className="brand-product">Docs</span>
  </AppLink>;
}
