import type { WorkbenchResourceNode } from "./useWorkbenchResources";

export interface WorkbenchResourceTreeProps {
  nodes: readonly WorkbenchResourceNode[];
  selectedNodeId?: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
}

function CapabilityBadges({ node }: { node: WorkbenchResourceNode }) {
  if (!node.capabilities.open) return null;

  return (
    <span className="workbench-resource-tree__badges">
      {node.capabilities.edit ? <span>可编辑</span> : null}
      {node.capabilities.readonly ? <span>只读</span> : null}
      {node.capabilities.unsupported ? <span>不支持</span> : null}
      {node.capabilities.delete ? <span>可删除</span> : null}
      {node.capabilities.apply ? <span>可应用</span> : null}
    </span>
  );
}

function ResourceNode({ node, selectedNodeId, onOpen }: WorkbenchResourceTreeProps & { node: WorkbenchResourceNode }) {
  const children = node.children?.length ? (
    <ul>
      {node.children.map((child) => (
        <li key={child.id}>
          <ResourceNode node={child} selectedNodeId={selectedNodeId} onOpen={onOpen} nodes={[]} />
        </li>
      ))}
    </ul>
  ) : null;

  if (!node.capabilities.open) {
    return (
      <section aria-label={node.title}>
        <strong>{node.title}</strong>
        {children}
      </section>
    );
  }

  return (
    <>
      <button type="button" aria-current={node.id === selectedNodeId ? "true" : undefined} onClick={() => onOpen(node)}>
        <span>{node.title}</span>
        <CapabilityBadges node={node} />
      </button>
      {children}
    </>
  );
}

export function WorkbenchResourceTree({ nodes, selectedNodeId = null, onOpen }: WorkbenchResourceTreeProps) {
  return (
    <nav aria-label="写作资源树" className="workbench-resource-tree">
      <ul>
        {nodes.map((node) => (
          <li key={node.id}>
            <ResourceNode node={node} selectedNodeId={selectedNodeId} onOpen={onOpen} nodes={nodes} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
