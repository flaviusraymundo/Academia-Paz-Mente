"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api, getApiBase } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { CourseCard, Course } from "../components/catalog/CourseCard";
import { TrackSection, Track } from "../components/catalog/TrackSection";

type CatalogResponse = {
  courses?: Course[];
  tracks?: Track[];
};

export default function CatalogPage() {
  const { jwt, ready } = useAuth();
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    if (!ready) return;
    if (!jwt) {
      setCatalog(null);
      setError(null);
      setLoading(false);
      return;
    }

    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { status, body } = await api<CatalogResponse>("/api/catalog", { jwt });
      if (!alive) return;
      if (status === 200 && typeof body === "object") {
        setCatalog(body);
        setError(null);
      } else {
        setCatalog(null);
        setError({ status, body });
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [jwt, ready]);

  const apiBase = getApiBase();
  const courses = useMemo(() => catalog?.courses ?? [], [catalog]);
  const tracks = useMemo(() => catalog?.tracks ?? [], [catalog]);
  const coursesById = useMemo(() => Object.fromEntries(courses.map((c) => [c.id, c])), [courses]);

  return (
    <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap: 28 }}>
      <div style={{ display:"flex", alignItems:"center", gap:16 }}>
        <h2 style={{ margin: 0, fontSize: 26 }}>Catálogo</h2>
        {!apiBase && (
          <span style={{ fontSize:12, color:"#a33", border:"1px solid #f1b5b5", padding:"4px 8px", borderRadius:999, background:"#ffecec" }}>
            NEXT_PUBLIC_API_BASE não definida
          </span>
        )}
      </div>

      {ready && !jwt && (
        <Card style={{ padding:16, gap:8 }}>
          <strong>Não autenticado</strong>
          <p style={{ margin:0, fontSize:13, color:"var(--color-text-soft)" }}>
            Clique em “Entrar” (topo) para visualizar seus cursos.
          </p>
        </Card>
      )}

      {loading && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:20 }}>
          {Array.from({ length: 4 }).map((_,i)=>(
            <Card key={i}>
              <Skeleton h={18} w="60%" />
              <Skeleton h={12} w="90%" />
              <Skeleton h={12} w="80%" />
              <div style={{ display:"flex", gap:8, marginTop:8 }}>
                <Skeleton h={28} w={100} />
                <Skeleton h={22} w={60} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {error && !loading && (
        <Card style={{ borderColor:"#f2c2c2", background:"#fff6f6", color:"#842029" }}>
          <strong>Erro ao carregar catálogo</strong>
          <pre style={{ margin:0, whiteSpace:"pre-wrap", fontSize:12 }}>
            {JSON.stringify(error, null, 2)}
          </pre>
        </Card>
      )}

      {!loading && !error && tracks.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:40 }}>
          {tracks.map((t) => (
            <TrackSection key={t.id} track={t} coursesById={coursesById} />
          ))}
        </div>
      )}

      {!loading && !error && tracks.length === 0 && courses.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:20 }}>
          {courses.map((c) => <CourseCard key={c.id} course={c} />)}
        </div>
      )}

      {jwt && !loading && !error && catalog && courses.length === 0 && tracks.length === 0 && (
        <p style={{ fontSize:14, color:"#555" }}>Nenhum curso disponível.</p>
      )}
    </div>
  );
}
