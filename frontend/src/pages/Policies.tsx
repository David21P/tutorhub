import { Link } from 'react-router-dom';

export default function Policies() {
  return (
    <article className="card stack" style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1>Políticas de uso de TutorHub</h1>
      <p className="muted">Normas que protegen a estudiantes y tutores. Su incumplimiento puede causar la suspensión de la cuenta.</p>
      <h2>1. Asistencia y puntualidad</h2>
      <p>Las tutorías aprobadas deben cumplirse en el horario acordado. Si no puede asistir, cancélela con anticipación desde la plataforma. La inasistencia reiterada sin aviso puede ser sancionada.</p>
      <h2>2. Trato respetuoso</h2>
      <p>No se toleran insultos, acoso, discriminación ni contenido inapropiado, ya sea en las clases o en el chat de la plataforma.</p>
      <h2>3. Cobros transparentes</h2>
      <p>El costo de cada tutoría es el que muestra el presupuesto (tarifa por hora más traslado por kilómetro cuando aplica). Está prohibido solicitar cobros adicionales o fuera de la plataforma sobre lo acordado.</p>
      <h2>4. Veracidad de la información</h2>
      <p>Los datos del perfil, la hoja de vida y las credenciales deben ser verdaderos. Los tutores son revisados por un administrador antes de publicarse.</p>
      <h2>5. Reportes y apelaciones</h2>
      <p>Cualquier usuario puede reportar una conducta indebida adjuntando evidencia textual. Los administradores revisan cada reporte. Si su cuenta es suspendida puede enviar una apelación; mientras no sea aceptada, la cuenta permanece bloqueada.</p>
      <p>
        <Link to="/">Volver al inicio</Link>
      </p>
    </article>
  );
}
