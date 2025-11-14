"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { Module } from "../../../types/course";
import { CourseHeader } from "../../../components/course/CourseHeader";
import { ModuleCard } from "../../../components/course/ModuleCard";
import { Card } from "../../../components/ui/Card";
import { Skeleton } from "../../../components/ui/Skeleton";
import { ModuleItemsResponseSchema } from "../../../schemas/modules";

export default function CoursePage() {
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;
  const [mods, setMods] = useState<Module[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { jwt, ready } = useRequireAuth();

  useEffect(() => {
    if (!ready) return;

    if (!jwt) {
      setMods([]);
      setErr(null);
      setLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams({ courseId });
        const { status, body } = await api(`/api/me/items?${qs.toString()}`, { jwt });
        if (!alive) return;

        if (status === 200) {
          const parsed = ModuleItemsResponseSchema.safeParse(body);
          if (parsed.success) {
            setMods(parsed.data.items || []);
            setErr(null);
          } else {
            setMods([]);
            setErr(JSON.stringify({ status, validationError: parsed.error.flatten() }));
          }
        } else {
          setMods([]);
          setErr(JSON.stringify({ status, body }));
        }
      } catch (error) {
        if (!alive) return;
        setMods([]);
        setErr(JSON.stringify({ error: String(error) }));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [courseId, jwt, ready]);

  const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "1";
  const title = useMemo(() => `Curso`, []);

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <CourseHeader
        title={
          <>
            {title}{" "}
            <span style={{ fontSize: 12, color: "#777", marginLeft: 8 }}>
              <code>{courseId}</code>
            </span>
          </>
        }
        right={
          DEBUG ? (
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#777" }}>DEBUG on</span>
            </div>
          ) : null
        }
      />

      {!ready && (
        <div style={{ display: "grid", gap: 10 }}>
          <Card>
            <Skeleton h={16} w="40%" />
            <Skeleton h={12} w="90%" />
          </Card>
          <Card>
            <Skeleton h={16} w="60%" />
            <Skeleton h={12} w="85%" />
          </Card>
        </div>
      )}

      {ready && !jwt && (
        <Card>
          <strong>Não autenticado</strong>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-soft)" }}>
            Clique em “Entrar” (topo) para visualizar o conteúdo do curso.
          </p>
        </Card>
      )}

      {ready && jwt && loading && (
        <div style={{ display: "grid", gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <Skeleton h={18} w="50%" />
              <Skeleton h={12} w="90%" />
              <Skeleton h={12} w="80%" />
            </Card>
          ))}
        </div>
      )}

      {ready && jwt && err && !loading && (
        <Card style={{ borderColor: "#f2c2c2", background: "#fff6f6", color: "#842029" }}>
          <strong>Erro ao carregar módulos</strong>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>{err}</pre>
        </Card>
      )}

      {ready && jwt && !err && !loading && mods.length === 0 && (
        <p style={{ fontSize: 14, color: "#555" }}>Nenhum módulo disponível.</p>
      )}

      {ready && jwt && !err && !loading && mods.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {mods
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((m) => (
              <ModuleCard key={m.id} m={m} courseId={courseId} />
            ))}
        </div>
      )}
    </div>
  );
}
