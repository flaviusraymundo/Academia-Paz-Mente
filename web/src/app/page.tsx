"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { CourseCard, Course } from "../components/catalog/CourseCard";
import { TrackSection } from "../components/catalog/TrackSection";
import { Skeleton } from "../components/ui/Skeleton";
import { Card } from "../components/ui/Card";

interface CatalogResponse {
  courses?: Course[];
  tracks?: {
    id: string;
    slug?: string;
    title: string;
    active?: boolean;
    courses: { courseId: string; order: number; required: boolean }[];
  }[];
}

export default function CatalogPage() {
  const [jwt, setJwt] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<any>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);

  useEffect(() => {
    try { setJwt(localStorage.getItem("jwt") || ""); } catch {}
  }, []);

  useEffect(() => {
    // JWT ausente: refletir estado não autenticado e limpar dados sensíveis
    if (!jwt) {
      setLoading(false);
      setErr(null);        // evita mostrar erro antigo após logout
      setCatalog(null);    // evita exibir cursos privados após logout
      return;
    }

    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);        // limpa erro antes da nova tentativa

      const { status, body } = await api("/api/catalog");
      if (!alive) return;

      if (status === 200 && typeof body === "object") {
        setCatalog(body);
        setErr(null);      // garante que erro não persiste após sucesso
      } else {
        setCatalog(null);  // não manter dados possivelmente antigos
        setErr({ status, body });
      }

      setLoading(false);
    })();
    return () => { alive = false; };
  }, [jwt]);

  const courses = catalog?.courses || [];
  const tracks = catalog?.tracks || [];
  const coursesById = Object.fromEntries(courses.map(c => [c.id, c]));

  return (
    <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:28 }}>
      <div style={{ display:"flex", alignItems:"center", gap:16 }}>
        <h1 style={{ margin:"0 0 4px 0", fontSize:26 }}>Catálogo</h1>
        {!process.env.NEXT_PUBLIC_API_BASE && (
          <span style={{ fontSize:12, color:"#a33", border:"1px solid #f1b5b5", padding:"4px 8px", borderRadius:999, background:"#ffecec" }}>
            NEXT_PUBLIC_API_BASE não definida
          </span>
        )}
      </div>

      {!jwt && (
        <Card style={{ padding:16, gap:8 }}>
          <strong>Não autenticado</strong>
          <p style={{ margin:0, fontSize:13, color:"var(--color-text-soft)" }}>
            Clique em “Entrar” para colar seu token e visualizar cursos.
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

      {err && !loading && (
        <Card style={{ borderColor:"#f2c2c2", background:"#fff6f6", color:"#842029" }}>
          <strong>Erro ao carregar catálogo</strong>
          <pre style={{ margin:0, whiteSpace:"pre-wrap", fontSize:12 }}>{JSON.stringify(err, null, 2)}</pre>
        </Card>
      )}

      {!loading && !err && tracks.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:40 }}>
          {tracks.map(t => <TrackSection key={t.id} track={t} coursesById={coursesById} />)}
        </div>
      )}

      {!loading && !err && tracks.length === 0 && courses.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:20 }}>
          {courses.map(c => <CourseCard key={c.id} course={c} />)}
        </div>
      )}

      {jwt && !loading && !err && catalog && courses.length === 0 && (
        <p style={{ fontSize:14, color:"#555" }}>Nenhum curso disponível.</p>
      )}
    </div>
  );
}
