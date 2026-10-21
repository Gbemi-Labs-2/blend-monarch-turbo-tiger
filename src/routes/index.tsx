import { createFileRoute } from "@tanstack/react-router";
import { AureliaApp } from "../../monopoly-ultimate/ui/AureliaApp";

export const Route = createFileRoute("/")({ component: AureliaApp });
