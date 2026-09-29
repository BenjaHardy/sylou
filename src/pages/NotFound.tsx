const NotFound = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--ethos-surface))]">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">This page doesn't exist.</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Back to Sylou
        </a>
      </div>
    </div>
  );
};

export default NotFound;
