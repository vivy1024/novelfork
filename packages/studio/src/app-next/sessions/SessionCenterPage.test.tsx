import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock("../../components/sessions/SessionCenter", () => ({
  SessionCenter: (props: Record<string, unknown>) => {
    mocks.props.push(props);
    return <div data-testid="runtime-session-center" />;
  },
}));

import { SessionCenterPage } from "./SessionCenterPage";

afterEach(() => {
  cleanup();
  mocks.props.length = 0;
});

describe("SessionCenterPage", () => {
  it("mounts the Runtime narrator lifecycle center", () => {
    const client = { listNarrators: vi.fn() };
    const onOpenNarrator = vi.fn();
    const onChanged = vi.fn();

    render(
      <SessionCenterPage
        client={client as never}
        initialCreateOpen
        onOpenNarrator={onOpenNarrator}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByTestId("runtime-session-center")).toBeTruthy();
    expect(mocks.props.at(-1)).toMatchObject({
      client,
      initialCreateOpen: true,
      onOpenNarrator,
      onChanged,
    });
  });
});
