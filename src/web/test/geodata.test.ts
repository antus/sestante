import { describe, expect, it } from "vitest";
import { buildLayer, featureCount, INLINE_MAX_BYTES, isGeoJson, pickMode, type GeoJson } from "../src/lib/geodata";

const collection: GeoJson = {
  type: "FeatureCollection",
  features: [{ geometry: { type: "Point" } }, { geometry: { type: "LineString" } }],
};

describe("isGeoJson", () => {
  it("riconosce i tipi radice di GeoJSON", () => {
    for (const type of ["FeatureCollection", "Feature", "Point", "MultiPolygon", "GeometryCollection"]) {
      expect(isGeoJson({ type }), type).toBe(true);
    }
  });

  it("rifiuta ciò che GeoJSON non è", () => {
    for (const value of [null, undefined, "FeatureCollection", 42, {}, { type: "Topology" }, { type: 1 }, []]) {
      expect(isGeoJson(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("featureCount", () => {
  it("conta le feature di una collezione, e vale 1 per una geometria sola", () => {
    expect(featureCount(collection)).toBe(2);
    expect(featureCount({ type: "Point" })).toBe(1);
    expect(featureCount({ type: "FeatureCollection", features: [] })).toBe(0);
  });
});

describe("buildLayer", () => {
  it("è sempre di tipo geojson: è ciò che fa disegnare il livello a GeoLibre", () => {
    const layer = buildLayer({ id: "a", name: "Punti", geojson: { type: "Point" } });
    expect(layer.type).toBe("geojson");
    expect(layer.source.type).toBe("geojson");
  });

  it("in modo inline porta la geometria nel progetto", () => {
    const layer = buildLayer({ id: "a", name: "Punti", geojson: collection });
    expect(layer.geojson).toBe(collection);
    expect(layer.source.data).toBeUndefined();
  });

  it("in modo url referenzia il file e non duplica la geometria", () => {
    const layer = buildLayer({ id: "a", name: "Punti", geojson: collection, url: "https://host/api/maps/m/files/f?k=s" });
    expect(layer.source.data).toBe("https://host/api/maps/m/files/f?k=s");
    expect(layer).not.toHaveProperty("geojson");
  });

  it("non mette i contrassegni per cui GeoLibre scarterebbe la geometria", () => {
    expect(buildLayer({ id: "a", name: "x", geojson: collection }).metadata).toEqual({});
  });

  it("ogni livello ha il suo stile, non uno condiviso", () => {
    const a = buildLayer({ id: "a", name: "a", geojson: collection });
    const b = buildLayer({ id: "b", name: "b", geojson: collection });
    a.style.fillColor = "#000000";
    expect(b.style.fillColor).not.toBe("#000000");
  });
});

describe("pickMode", () => {
  it("con GeoLibre e Sestante sullo stesso schema usa l'url", () => {
    expect(pickMode({ size: 10 ** 9, sestanteOrigin: "http://localhost:4000", geolibreUrl: "/gis/" })).toBe("url");
    expect(pickMode({ size: 1, sestanteOrigin: "https://host", geolibreUrl: "https://host/gis/" })).toBe("url");
  });

  it("con GeoLibre in https e Sestante in http incorpora finché il file ci sta", () => {
    const blocked = { sestanteOrigin: "http://localhost:4000", geolibreUrl: "https://web.geolibre.app" };
    expect(pickMode({ ...blocked, size: INLINE_MAX_BYTES })).toBe("inline");
    expect(pickMode({ ...blocked, size: INLINE_MAX_BYTES + 1 })).toBe("too-large");
  });

  it("un indirizzo di GeoLibre malformato non blocca nulla", () => {
    expect(pickMode({ size: 1, sestanteOrigin: "non un url", geolibreUrl: "::" })).toBe("url");
  });
});
